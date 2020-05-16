import { Subscription, of, Observable, ReplaySubject } from 'rxjs';
import { delay, map, mergeMap, filter, first } from 'rxjs/operators';
import { NgZone, Injector } from '@angular/core';
import BigNumber from 'bignumber.js';

import { Coin } from '../../../coins/coin';
import { ProgressEvent, BlockchainState } from '../../blockchain.service';
import { BlockchainOperator } from '../blockchain-operator';
import { BalanceAndOutputsOperator } from '../balance-and-outputs-operator';
import { OperatorService } from '../../operators.service';
import { EthApiService } from '../../api/eth-api.service';

/**
 * Operator for BlockchainService to be used with eth-like coins.
 *
 * NOTE: still under heavy development.
 *
 * You can find more information about the functions and properties this class implements by
 * checking BlockchainService and BlockchainOperator.
 */
export class EthBlockchainOperator implements BlockchainOperator {
  private progressSubject: ReplaySubject<ProgressEvent> = new ReplaySubject<ProgressEvent>(1);

  private dataSubscription: Subscription;
  private operatorsSubscription: Subscription;

  /**
   * Time interval in which periodic data updates will be made.
   */
  private updatePeriod = 2 * 1000;
  /**
   * Time interval in which the periodic data updates will be restarted after an error.
   */
  private errorUpdatePeriod = 2 * 1000;

  get progress(): Observable<ProgressEvent> {
    return this.progressSubject.asObservable();
  }

  // Coin the current instance will work with.
  private currentCoin: Coin;

  // Services and operators used by this operator.
  private ethApiService: EthApiService;
  private ngZone: NgZone;
  private balanceAndOutputsOperator: BalanceAndOutputsOperator;

  constructor(injector: Injector, currentCoin: Coin) {
    // Get the services.
    this.ethApiService = injector.get(EthApiService);
    this.ngZone = injector.get(NgZone);

    // Intervals for updating the data must be longer if connecting to a remote node.
    if (!currentCoin.isLocal) {
      this.updatePeriod = 120 * 1000;
      this.errorUpdatePeriod = 30 * 1000;
    }

    // Get the operators and only then start using them.
    this.operatorsSubscription = injector.get(OperatorService).currentOperators.pipe(filter(operators => !!operators), first()).subscribe(operators => {
      this.balanceAndOutputsOperator = operators.balanceAndOutputsOperator;

      // Start checking the state of the blockchain.
      this.startDataRefreshSubscription(0);
    });

    this.currentCoin = currentCoin;
  }

  dispose() {
    this.operatorsSubscription.unsubscribe();
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }

    this.progressSubject.complete();
  }

  getBlockchainState(): Observable<BlockchainState> {
    // TODO: implement.
    return null;
  }

  /**
   * Makes the operator start periodically checking the synchronization state of the blockchain.
   * If this function was called before, the previous procedure is cancelled.
   * @param delayMs Delay before starting to check the data.
   */
  private startDataRefreshSubscription(delayMs: number) {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }

    this.ngZone.runOutsideAngular(() => {
      this.dataSubscription = of(0).pipe(
        delay(delayMs),
        mergeMap(() => {
          return this.ethApiService.callRpcMethod(this.currentCoin.nodeUrl, 'eth_syncing');
        }),
      ).subscribe(result => {
        this.ngZone.run(() => {
          if (result === false) {
            // If the result is false, the blockchain is synchronized.
            this.progressSubject.next({
              currentBlock: 0,
              highestBlock: 0,
              synchronized: true,
            });
          } else {
            this.progressSubject.next({
              currentBlock: new BigNumber((result.currentBlock as string).substr(2), 16).toNumber(),
              highestBlock: new BigNumber((result.highestBlock as string).substr(2), 16).toNumber(),
              synchronized: false,
            });
          }

          this.startDataRefreshSubscription(this.updatePeriod);
        });
      }, () => {
        this.startDataRefreshSubscription(this.errorUpdatePeriod);
      });
    });
  }
}