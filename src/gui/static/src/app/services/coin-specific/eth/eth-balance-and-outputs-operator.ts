import { of, Observable, ReplaySubject, Subscription, BehaviorSubject, forkJoin } from 'rxjs';
import { NgZone, Injector } from '@angular/core';
import { mergeMap, map, delay, tap, first, filter } from 'rxjs/operators';
import BigNumber from 'bignumber.js';

import { WalletWithBalance, walletWithBalanceFromBase, WalletBase, WalletWithOutputs } from '../../wallet-operations/wallet-objects';
import { Output } from '../../wallet-operations/transaction-objects';
import { Coin } from '../../../coins/coin';
import { BalanceAndOutputsOperator } from '../balance-and-outputs-operator';
import { OperatorService } from '../../operators.service';
import { EthApiService } from '../../api/eth-api.service';
import { EthCoinConfig } from '../../../coins/config/eth.coin-config';

/**
 * Balance of a wallet, for internal use.
 */
class WalletBalance {
  current = new BigNumber(0);
  predicted = new BigNumber(0);
  addresses = new Map<string, AddressBalance>();
}

/**
 * Balance of an address, for internal use.
 */
class AddressBalance {
  current = new BigNumber(0);
  predicted = new BigNumber(0);
}

/**
 * Operator for BalanceAndOutputsService to be used with eth-like coins.
 *
 * NOTE: eth-like coins don't use outputs.
 *
 * You can find more information about the functions and properties this class implements by
 * checking BalanceAndOutputsOperator and BalanceAndOutputsService.
 */
export class EthBalanceAndOutputsOperator implements BalanceAndOutputsOperator {
  // The list of wallets with balance and the subject used for informing when the list has been modified.
  private walletsWithBalanceList: WalletWithBalance[];
  private walletsWithBalanceSubject: ReplaySubject<WalletWithBalance[]> = new ReplaySubject<WalletWithBalance[]>(1);

  // Subject for providing information in the getters below.
  private lastBalancesUpdateTimeSubject: ReplaySubject<Date> = new ReplaySubject<Date>(1);
  private hasPendingTransactionsSubject: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private firstFullUpdateMadeSubject: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private hadErrorRefreshingBalanceSubject: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private refreshingBalanceSubject: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  private dataRefreshSubscription: Subscription;
  private walletsSubscription: Subscription;
  private operatorsSubscription: Subscription;

  /**
   * Time interval in which periodic data updates will be made.
   */
  private updatePeriod = 10 * 1000;
  /**
   * Time interval in which the periodic data updates will be restarted after an error.
   */
  private errorUpdatePeriod = 2 * 1000;

  /**
   * After the service retrieves the balance of each wallet, the balance returned
   * by the node for each wallet is saved here, accessible via the wallet id.
   */
  private savedBalanceData = new Map<string, WalletBalance>();
  /**
   * Temporal map for updating savedBalanceData only after retrieving the data of all wallets,
   * to avoid problems when the balance update procedure is cancelled early.
   */
  private temporalSavedBalanceData = new Map<string, WalletBalance>();
  /**
   * Saves the lastest, most up to date, wallet list obtained from the wallets service.
   */
  private savedWalletsList: WalletBase[];

  // Coin the current instance will work with.
  private currentCoin: Coin;

  // Services and operators used by this operator.
  private ethApiService: EthApiService;
  private ngZone: NgZone;

  constructor(injector: Injector, currentCoin: Coin) {
    // Get the services.
    this.ethApiService = injector.get(EthApiService);
    this.ngZone = injector.get(NgZone);

    // Intervals for updating the data must be longer if connecting to a remote node.
    if (!currentCoin.isLocal) {
      this.updatePeriod = 600 * 1000;
      this.errorUpdatePeriod = 60 * 1000;
    }

    // Get the operators and only then start using them.
    this.operatorsSubscription = injector.get(OperatorService).currentOperators.pipe(filter(operators => !!operators), first()).subscribe(operators => {
      // Update the balance immediately each time the wallets are updated.
      this.walletsSubscription = operators.walletsAndAddressesOperator.currentWallets.subscribe(wallets => {
        this.savedWalletsList = wallets;
        this.startDataRefreshSubscription(0, true);
      });
    });

    this.currentCoin = currentCoin;
  }

  dispose() {
    this.operatorsSubscription.unsubscribe();
    if (this.walletsSubscription) {
      this.walletsSubscription.unsubscribe();
    }
    if (this.dataRefreshSubscription) {
      this.dataRefreshSubscription.unsubscribe();
    }

    this.lastBalancesUpdateTimeSubject.complete();
    this.walletsWithBalanceSubject.complete();
    this.hasPendingTransactionsSubject.complete();
    this.firstFullUpdateMadeSubject.complete();
    this.hadErrorRefreshingBalanceSubject.complete();
    this.refreshingBalanceSubject.complete();
  }

  get lastBalancesUpdateTime(): Observable<Date> {
    return this.lastBalancesUpdateTimeSubject.asObservable();
  }

  get walletsWithBalance(): Observable<WalletWithBalance[]> {
    return this.walletsWithBalanceSubject.asObservable();
  }

  get hasPendingTransactions(): Observable<boolean> {
    return this.hasPendingTransactionsSubject.asObservable();
  }

  get firstFullUpdateMade(): Observable<boolean> {
    return this.firstFullUpdateMadeSubject.asObservable();
  }

  get hadErrorRefreshingBalance(): Observable<boolean> {
    return this.hadErrorRefreshingBalanceSubject.asObservable();
  }

  get refreshingBalance(): Observable<boolean> {
    return this.refreshingBalanceSubject.asObservable();
  }

  get outputsWithWallets(): Observable<WalletWithOutputs[]> {
    return of([]);
  }

  getOutputs(addresses: string): Observable<Output[]> {
    return of([]);
  }

  getWalletUnspentOutputs(wallet: WalletBase): Observable<Output[]> {
    return of([]);
  }

  refreshBalance() {
    this.startDataRefreshSubscription(0, false);
  }

  /**
   * Makes the service start updating the balance periodically. If this function was called
   * before, the previous updating procedure is cancelled.
   * @param delayMs Delay before starting to update the balance.
   * @param updateWalletsFirst If true, after the delay the function will inmediatelly update
   * the wallet list with the data on savedWalletsList and using the last balance data obtained
   * from the node (or will set all the wallets to 0, if no data exists) and only after that will
   * try to get the balance data from the node and update the wallet list again. This allows to
   * inmediatelly reflect changes made to the wallet list, without having to wait for the node
   * to respond.
   */
  private startDataRefreshSubscription(delayMs: number, updateWalletsFirst: boolean) {
    if (this.dataRefreshSubscription) {
      this.dataRefreshSubscription.unsubscribe();
    }

    if (this.savedWalletsList) {
      this.ngZone.runOutsideAngular(() => {
        this.dataRefreshSubscription = of(0).pipe(delay(delayMs), mergeMap(() => {
          // Inform the balance is being updated.
          this.ngZone.run(() => {
            this.refreshingBalanceSubject.next(true);
          });

          // Update the wallet list with the last saved data, if requested.
          if (updateWalletsFirst) {
            return this.refreshBalances(this.savedWalletsList, true);
          } else {
            return of(0);
          }
        }), mergeMap(() => {
          // Refresh the balance.
          return this.refreshBalances(this.savedWalletsList, false);
        })).subscribe(
          () => {
            this.ngZone.run(() => {
              this.hadErrorRefreshingBalanceSubject.next(false);
              this.refreshingBalanceSubject.next(false);
            });

            // Repeat the operation after a delay.
            this.startDataRefreshSubscription(this.updatePeriod, false);
          },
          () => {
            this.ngZone.run(() => {
              this.hadErrorRefreshingBalanceSubject.next(true);
              this.refreshingBalanceSubject.next(false);
            });

            // Repeat the operation after a delay.
            this.startDataRefreshSubscription(this.errorUpdatePeriod, false);
          },
        );
      });
    }
  }

  /**
   * Refreshes the wallets on walletsWithBalanceList and their balances.
   * @param wallets The current wallet lists.
   * @param forceQuickCompleteArrayUpdate If true, the balance data saved on savedBalanceData
   * will be used to set the balance of the wallet list, instead of getting the data from
   * the node. If false, the balance data is obtained from the node and savedBalanceData is
   * updated.
   */
  private refreshBalances(wallets: WalletBase[], forceQuickCompleteArrayUpdate: boolean): Observable<any> {
    // Create a copy of the wallet list.
    const temporalWallets: WalletWithBalance[] = [];
    wallets.forEach(wallet => {
      temporalWallets.push(walletWithBalanceFromBase(wallet));
    });

    // This will help to update savedBalanceData when finishing the procedure.
    if (!forceQuickCompleteArrayUpdate) {
      this.temporalSavedBalanceData = new Map<string, any>();
    }

    let procedure: Observable<boolean[]>;
    if (wallets.length > 0) {
      // Get the balance of each wallet.
      procedure = forkJoin(temporalWallets.map(wallet => this.retrieveWalletBalance(wallet, forceQuickCompleteArrayUpdate)));
    } else {
      // Create a fake response, as there are no wallets.
      procedure = of([false]);
    }

    // Calculate the balance of each wallet.
    return procedure.pipe(tap(walletHasPendingTx => {
      this.hasPendingTransactionsSubject.next(walletHasPendingTx.some(value => value));

      if (!forceQuickCompleteArrayUpdate) {
        this.ngZone.run(() => {
          this.lastBalancesUpdateTimeSubject.next(new Date());
        });
      }

      if (!this.walletsWithBalanceList || forceQuickCompleteArrayUpdate || this.walletsWithBalanceList.length !== temporalWallets.length) {
        // Update the whole list.
        this.walletsWithBalanceList = temporalWallets;
        this.informDataUpdated();
      } else {
        // If there is a change in the IDs of the wallet list, update the whole list.
        let changeDetected = false;
        this.walletsWithBalanceList.forEach((currentWallet, i) => {
          if (currentWallet.id !== temporalWallets[i].id) {
            changeDetected = true;
          }
        });

        if (changeDetected) {
          this.walletsWithBalanceList = temporalWallets;
          this.informDataUpdated();
        } else {
          // Update only the balances with changes.
          this.walletsWithBalanceList.forEach((currentWallet, i) => {
            if (!currentWallet.coins.isEqualTo(temporalWallets[i].coins)) {
              currentWallet.coins = temporalWallets[i].coins;
              changeDetected = true;
            }

            if (currentWallet.addresses.length !== temporalWallets[i].addresses.length) {
              currentWallet.addresses = temporalWallets[i].addresses;
              changeDetected = true;
            } else {
              currentWallet.addresses.forEach((currentAddress, j) => {
                if (!currentAddress.coins.isEqualTo(temporalWallets[i].addresses[j].coins)) {
                  currentAddress.coins = temporalWallets[i].addresses[j].coins;
                  changeDetected = true;
                }
              });
            }
          });

          // If any of the balances changed, inform that there were changes.
          if (changeDetected) {
            this.informDataUpdated();
          }
        }
      }

      if (!forceQuickCompleteArrayUpdate) {
        this.savedBalanceData = this.temporalSavedBalanceData;
        if (!this.firstFullUpdateMadeSubject.value) {
          // Inform that the service already obtained the balance from the node for the first time.
          this.ngZone.run(() => {
            this.firstFullUpdateMadeSubject.next(true);
          });
        }
      }
    }));
  }

  /**
   * Gets from the node the balance of a wallet and uses the retrieved data to update an instamce
   * of WalletWithBalance. It also saves the retrieved data on temporalSavedBalanceData.
   * @param wallet Wallet to update.
   * @param useSavedBalanceData If true, the balance data saved on savedBalanceData
   * will be used instead of retrieving the data from the node.
   * @returns True if there are one or more pending transactions that will affect the balance of
   * the provided walled, false otherwise. If useSavedBalanceData is true, the value of
   * hasPendingTransactionsSubject will be returned.
   */
  private retrieveWalletBalance(wallet: WalletWithBalance, useSavedBalanceData: boolean): Observable<boolean> {
    let query: Observable<WalletBalance>;

    if (!useSavedBalanceData) {
      // Get the number of the lastest block.
      query = this.ethApiService.callRpcMethod(this.currentCoin.nodeUrl, 'eth_blockNumber').pipe(mergeMap(result => {
        const currentBlockNumber = new BigNumber((result as string).substr(2), 16).toNumber();
        const addresses = wallet.addresses.map(a => a.address);

        // Get the balance of all addresses.
        return this.recursivelyGetBalances(addresses, currentBlockNumber);
      }), map(result => {
        const balance = new WalletBalance();

        // Add the balances.
        wallet.addresses.forEach(address => {
          let addressBalance: AddressBalance;
          if (result.has(address.address)) {
            addressBalance = result.get(address.address);
          } else {
            addressBalance = new AddressBalance();
          }

          balance.addresses.set(address.address, addressBalance);
          balance.current = balance.current.plus(addressBalance.current);
          balance.predicted = balance.predicted.plus(addressBalance.predicted);
        });

        return balance;
      }));
    } else {
      // Get the balance from the saved data, if possible.
      if (this.savedBalanceData.has(wallet.id)) {
        query = of(this.savedBalanceData.get(wallet.id));
      } else {
        query = of(new WalletBalance());
      }
    }

    // Add the values to the wallet object.
    return query.pipe(map(balance => {
      this.temporalSavedBalanceData.set(wallet.id, balance);

      wallet.coins = balance.predicted;

      wallet.addresses.forEach(address => {
        if (balance.addresses.has(address.address)) {
          address.coins = balance.addresses.get(address.address).predicted;
        } else {
          address.coins = new BigNumber(0);
        }
      });

      if (!useSavedBalanceData) {
        return !balance.current.isEqualTo(balance.predicted);
      } else {
        return this.hasPendingTransactionsSubject.value;
      }
    }));
  }

  /**
   * Gets the balances of the addresses in the provided address list.
   * @param addresses Addresses to check. The list will be altered by the function.
   * @param currentElements Already obtained balances. For internal use.
   * @returns Map with the balances of the provided address list.
   */
  private recursivelyGetBalances(addresses: string[], currentBlockNumber: number, currentElements = new Map<string, AddressBalance>()): Observable<Map<string, AddressBalance>> {
    // Address to check during this pass.
    const currentAddress = addresses[addresses.length - 1];
    // Value which will allow to get the value in coins, instead of wei.
    const decimalsCorrector = new BigNumber(10).exponentiatedBy((this.currentCoin.config as EthCoinConfig).decimals);
    let predictedBalance: BigNumber;

    // Get the predicted balance.
    return this.ethApiService.callRpcMethod(this.currentCoin.nodeUrl, 'eth_getBalance', [currentAddress, 'pending']).pipe(mergeMap(response => {
      predictedBalance = new BigNumber((response as string).substr(2), 16).dividedBy(decimalsCorrector);

      let blockForLastConfirmedBalance = new BigNumber(currentBlockNumber).minus(this.currentCoin.confirmationsNeeded - 1);
      if (blockForLastConfirmedBalance.isLessThan(0)) {
        blockForLastConfirmedBalance = new BigNumber(0);
      }

      // Get the balance some blocks before, to get the confirmed balance.
      return this.ethApiService.callRpcMethod(this.currentCoin.nodeUrl, 'eth_getBalance', [currentAddress, '0x' + blockForLastConfirmedBalance.toString(16)]);
    }), mergeMap(response => {
      // Save the balance.
      currentElements.set(currentAddress, {
        current: new BigNumber((response as string).substr(2), 16).dividedBy(decimalsCorrector),
        predicted: predictedBalance,
      });

      // Go to the next address, if there are more addresses.
      if (addresses.length > 1) {
        addresses.pop();

        return this.recursivelyGetBalances(addresses, currentBlockNumber, currentElements);
      }

      return of(currentElements);
    }));
  }

  /**
   * Makes walletsWithBalanceSubject emit, to inform that the wallet list has been updated.
   */
  private informDataUpdated() {
    this.ngZone.run(() => {
      this.walletsWithBalanceSubject.next(this.walletsWithBalanceList);
    });
  }
}
