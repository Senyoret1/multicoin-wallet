import { Observable } from 'rxjs';

import { WalletBase } from '../wallet-operations/wallet-objects';
import { PendingTransactionsResponse, AddressesHistoryResponse, TransactionHistory } from '../wallet-operations/history.service';

/**
 * Interface with the elements the operators for HistoryService must have.
 * Much of it is similar to HistoryService, so you can find more info in that class.
 */
export interface HistoryOperator {
  /**
   * Makes the operator close all observables and run cleaning procedures. Must be called when
   * the operator is going to be replaced.
   */
  dispose();

  // Functions for consulting the transactions. Documented on the service.
  getIfAddressesUsed(wallet: WalletBase): Observable<Map<string, boolean>>;
  getTransactionsHistory(wallet: WalletBase|null): Observable<TransactionHistory>;
  getPendingTransactions(): Observable<PendingTransactionsResponse>;
  getAddressesHistory(wallet: WalletBase): Observable<AddressesHistoryResponse>;
}
