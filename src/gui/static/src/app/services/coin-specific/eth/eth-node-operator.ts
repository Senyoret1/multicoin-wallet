import { delay, mergeMap } from 'rxjs/operators';
import { BigNumber } from 'bignumber.js';
import { Subscription, of, Observable, BehaviorSubject } from 'rxjs';
import { Injector } from '@angular/core';

import { NodeOperator } from '../node-operator';
import { Coin } from '../../../coins/coin';
import { EthCoinConfig } from '../../../coins/config/eth.coin-config';
import { EthApiService } from '../../api/eth-api.service';

/**
 * Operator for NodeService to be used with eth-like coins.
 *
 * You can find more information about the functions and properties this class implements by
 * checking NodeService and NodeOperator.
 */
export class EthNodeOperator implements NodeOperator {
  get remoteNodeDataUpdated(): Observable<boolean> {
    return this.remoteNodeDataUpdatedInternal.asObservable();
  }
  private remoteNodeDataUpdatedInternal = new BehaviorSubject<boolean>(false);

  get nodeVersion() {
    return this.nodeVersionInternal;
  }
  private nodeVersionInternal = '';

  get currentMaxDecimals() {
    return (this.currentCoin.config as EthCoinConfig).decimals;
  }

  get burnRate() {
    return this.burnRateInternal;
  }
  private burnRateInternal = new BigNumber(1);

  // Coin the current instance will work with.
  private currentCoin: Coin;

  // Services used by this operator.
  private ethApiService: EthApiService;

  private basicInfoSubscription: Subscription;

  constructor(injector: Injector, currentCoin: Coin) {
    // Get the services.
    this.ethApiService = injector.get(EthApiService);

    this.currentCoin = currentCoin;

    this.updateData(0);
  }

  dispose() {
    if (this.basicInfoSubscription) {
      this.basicInfoSubscription.unsubscribe();
    }

    this.remoteNodeDataUpdatedInternal.complete();
  }

  /**
   * Connects to the node to get the data.
   */
  private updateData(delayMs: number) {
    if (this.basicInfoSubscription) {
      this.basicInfoSubscription.unsubscribe();
    }

    this.basicInfoSubscription = of(1).pipe(
      delay(delayMs),
      mergeMap(() => this.ethApiService.callRpcMethod(this.currentCoin.nodeUrl, 'web3_clientVersion')),
    ).subscribe(response => {
      // Get the version parts.
      const parts = (response as string).split('/');
      if (parts.length >= 2) {
        // Use the node name and version only.
        this.nodeVersionInternal = parts[0] + '/' + parts[1];
      } else {
        // If the format is unknown, limit the text to 15 characters.
        if ((response as string).length < 15) {
          this.nodeVersionInternal = response;
        } else {
          this.nodeVersionInternal = (response as string).substr(0, 12) + '...';
        }
      }

      this.remoteNodeDataUpdatedInternal.next(true);
    }, () => {
      // If there is an error, retry after a delay.
      this.updateData(this.currentCoin.isLocal ? 2000 : 15000);
    });
  }
}
