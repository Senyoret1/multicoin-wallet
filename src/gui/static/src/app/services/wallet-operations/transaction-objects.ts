/**
 * This file contains the objects used to represent the transactions and its parts in the app.
 */
import BigNumber from 'bignumber.js';

import { WalletBase } from './wallet-objects';

/**
 * Object with the properties of an input.
 */
export interface Input {
  hash: string;
  address: string;
  coins: BigNumber;
  hours?: BigNumber;
}

/**
 * Object with the properties of an output.
 */
export interface Output {
  hash: string;
  address: string;
  coins: BigNumber;
  hours?: BigNumber;
  confirmations?: number;
}

/**
 * Base transaction object, from which other transaction objects inherit.
 */
export interface TransactionBase {
  /**
   * Input list.
   */
  inputs: Input[];
  /**
   * Output list.
   */
  outputs: Output[];
  /**
   * Transaction fee, in coins or hours.
   */
  fee: BigNumber;
  /**
   * Local note set by the user to identify the transaction.
   */
  note?: string;
}

/**
 * Transaction generated by the app to be sent to the node.
 */
export interface GeneratedTransaction extends TransactionBase {
  /**
   * Indicates the wallet or addresses sending the transaction.
   */
  from: string;
  /**
   * List of addresses to were the transaction is sent.
   */
  to: string;
  /**
   * Encoded transaction.
   */
  encoded: string;
  /**
   * Inner hash of the transaction.
   */
  innerHash: string;
  /**
   * Wallet used to create the transaction, if an specific wallet was used.
   */
  wallet?: WalletBase;
  /**
   * How many coins the transaction is going to send.
   */
  coinsToSend: BigNumber;
  /**
   * How many hours the transaction is going to send.
   */
  hoursToSend?: BigNumber;
}

/**
 * List with the types for OldTransaction.
 */
export enum OldTransactionTypes {
  /**
   * Coins were received.
   */
  Incoming = 'Incoming',
  /**
   * Coins were sent.
   */
  Outgoing = 'Outgoing',
  /**
   * Coins were moved between addresses of the same wallet.
   */
  MovedBetweenAddresses = 'MovedBetweenAddresses',
  /**
   * Coins were moved between wallets the user has.
   */
  MovedBetweenWallets = 'MovedBetweenWallets',
  /**
   * The transaction involved a mix of addresses that did not allow to determine exactly
   * how the user's wallets were affected. Transaction objects with this type do not include
   * a balance.
   */
  MixedOrUnknown = 'MixedOrUnknown',
}

/**
 * Old transaction from the transactions history.
 */
export interface OldTransaction extends TransactionBase {
  /**
   * How many coins were received or sent (if the number is negative).
   */
  balance: BigNumber;
  /**
   * How many hours were received or sent (if the number is negative).
   */
  hoursBalance?: BigNumber;
  /**
   * The addresses which sent the coins o the ones which received them, depending on
   * whether the transaction was for sending or receiving coins.
   */
  relevantAddresses: string[];
  /**
   * Id of the transaction.
   */
  id: string;
  /**
   * Transaction timestamp, in Unix time.
   */
  timestamp: number;
  /**
   * If the transaction has been already confirmed by the network.
   */
  confirmed: boolean;
  /**
   * How many confirmations the transaction has in the network.
   */
  confirmations: number;
  /**
   * Transaction type.
   */
  type: OldTransactionTypes;
  /**
   * Names of the local wallets which were involved in the transaction.
   */
  involvedLocalWallets: string;
  /**
   * How many local wallets were involved in the transaction.
   */
  numberOfInvolvedLocalWallets: number;
}
