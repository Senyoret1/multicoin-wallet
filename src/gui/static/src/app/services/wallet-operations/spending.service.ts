import { Observable } from 'rxjs';
import { Injectable } from '@angular/core';

import { WalletBase } from './wallet-objects';
import { GeneratedTransaction } from './transaction-objects';
import { SpendingOperator } from '../coin-specific/spending-operator';
import { OperatorService } from '../operators.service';

/**
 * Defines a destination to were coins will be sent.
 */
export interface TransactionDestination {
  /**
   * Address to where the coins will be sent.
   */
  address: string;
  /**
   * How many coins to send.
   */
  coins: string;
  /**
   * How many hours to send. Only needed if the node is not supposed to calculate the
   * hours automatically.
   */
  hours?: string;
}

/**
 * Modes the node can use to distribute the hours when creating a transacton.
 */
export enum HoursDistributionTypes {
  /**
   * Every destination will have an specific amout of hours.
   */
  Manual = 'manual',
  /**
   * The node will automatically calculate how many hours to send to each output.
   */
  Auto = 'auto',
}

/**
 * Specifies how the node must distribute the hours when creating a transaction.
 */
export interface HoursDistributionOptions {
  /**
   * How the node will make the calculation.
   */
  type: HoursDistributionTypes;
  /**
   * Specific mode used if the node will automatically calculate the hours.
   */
  mode?: 'share';
  /**
   * Value used by the node to know how many hours to send and retain (is posible), if the node
   * will automatically calculate the hours.
   */
  share_factor?: string;
}

/**
 * Allows to create, prepare and send transactions.
 */
@Injectable()
export class SpendingService {
  /**
   * Instance with the actual code for making most of the operations of this service. It is
   * specific for the currently selected coin.
   */
  private operator: SpendingOperator;

  constructor(operatorService: OperatorService) {
    // Maintain the operator updated.
    operatorService.currentOperators.subscribe(operators => {
      if (operators) {
        this.operator = operators.spendingOperator;
      } else {
        this.operator = null;
      }
    });
  }

  /**
   * Creates a transaction, but does not send it to the network.
   * @param wallet Wallet from which the coins will be send. If null is provided, you will have to
   * provide a list of addresses or unspent outputs from were the coins will be sent and the function
   * will return an unsigned transaction.
   * @param addresses Optional list of addresses from were the coins will be sent. All addresses should
   * be from the provided wallet (if any). If an unspent outputs list is provided, this param is ignored.
   * @param unspents Optional list of unspent outputs from were the coins will be sent. All outputs
   * should be from the provided wallet (if any).
   * @param hoursDistributionOptions Object indicating how the hours will be distributed.
   * @param destinations Array with indications about hows many coins will be sent and where.
   * @param changeAddress Optional custom address where the remaining coins and hours will be sent. If not
   * provided, one will be selected automatically.
   * @param password Wallet password, if the wallet is encrypted.
   * @param unsigned If the transaction must be signed or not. When using a hw wallet the transaction will
   * have to be signed by the device, so it will have to be connected. If no wallet param was provided, this
   * param is ignored and the transaction will be unsigned.
   * @returns The generated transaction, without the note.
   */
  createTransaction(
    wallet: WalletBase|null,
    addresses: string[]|null,
    unspents: string[]|null,
    destinations: TransactionDestination[],
    hoursDistributionOptions: HoursDistributionOptions,
    changeAddress: string|null,
    password: string|null,
    unsigned: boolean): Observable<GeneratedTransaction> {

    return this.operator.createTransaction(
      wallet,
      addresses,
      unspents,
      destinations,
      hoursDistributionOptions,
      changeAddress,
      password,
      unsigned);
  }

  /**
   * Signs an unsigned transaction.
   * @param wallet Wallet which will be used to sign the transaction.
   * @param password Wallet password, if the provided walled is an encrypted software wallet.
   * @param transaction Transaction to sign.
   * @param rawTransactionString Encoded transaction to sign. If provided, the value of the
   * transaction param is ignored. Only valid if using a software wallet.
   * @returns The encoded signed transaction.
   */
  signTransaction(
    wallet: WalletBase,
    password: string|null,
    transaction: GeneratedTransaction,
    rawTransactionString = ''): Observable<string> {

    return this.operator.signTransaction(wallet, password, transaction, rawTransactionString);
  }

  /**
   * Sends a signed transaction to the network, to efectivelly send the coins.
   * @param encodedTx Transaction to send.
   * @param note Optional local note for the transaction.
   * @returns If the note was saved or not.
   */
  injectTransaction(encodedTx: string, note: string|null): Observable<boolean> {
    return this.operator.injectTransaction(encodedTx, note);
  }
}