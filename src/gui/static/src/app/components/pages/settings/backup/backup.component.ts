import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';

import { SeedModalComponent } from './seed-modal/seed-modal.component';
import { PasswordDialogComponent } from '../../../layout/password-dialog/password-dialog.component';
import { WalletsAndAddressesService } from '../../../../services/wallet-operations/wallets-and-addresses.service';
import { SoftwareWalletService } from '../../../../services/wallet-operations/software-wallet.service';
import { WalletBase, WalletTypes } from '../../../../services/wallet-operations/wallet-objects';
import { MsgBarService } from '../../../../services/msg-bar.service';
import { WalletUtilsService } from '../../../../services/wallet-operations/wallet-utils.service';
import { CoinService } from '../../../../services/coin.service';

/**
 * Allows to create a backup of the seed of an encrypted software wallet.
 */
@Component({
  selector: 'app-backup',
  templateUrl: './backup.component.html',
  styleUrls: ['./backup.component.scss'],
})
export class BackupComponent implements OnInit, OnDestroy {
  // Path of the folder which contains the software wallet files.
  folder: string;
  // Wallet list.
  wallets: WalletBase[] = [];

  walletTypes = WalletTypes;

  private folderSubscription: Subscription;
  private walletSubscription: Subscription;

  constructor(
    private dialog: MatDialog,
    private walletsAndAddressesService: WalletsAndAddressesService,
    private walletUtilsService: WalletUtilsService,
    private softwareWalletService: SoftwareWalletService,
    private msgBarService: MsgBarService,
    private coinService: CoinService,
    private router: Router,
  ) { }

  ngOnInit() {
    this.folderSubscription = this.walletUtilsService.folder().subscribe(folder => {
      this.folder = folder;
    }, err => {
      this.folder = '?';
      this.msgBarService.showError(err);
    });

    this.walletSubscription = this.walletsAndAddressesService.currentWallets.subscribe(wallets => {
      this.wallets = wallets;
    });

    if (!this.coinService.currentCoinInmediate.coinTypeFeatures.softwareWallets) {
      this.router.navigate([''], {replaceUrl: true});
    }
  }

  ngOnDestroy() {
    this.folderSubscription.unsubscribe();
    this.walletSubscription.unsubscribe();
  }

  // Creates a csv file with the addresses and makes the browser download it.
  saveAddresses(wallet: WalletBase) {
    // Create the address list.
    let addresses = '';
    wallet.addresses.forEach(address => {
      addresses += address.printableAddress + '\n';
    });
    addresses = addresses.substr(0, addresses.length - 1);

    // Create an invisible link and click it to download the data.
    const blob = new Blob([addresses], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', wallet.label + '.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      this.msgBarService.showError('backup.not-compatible-error');
    }
  }

  // Retrieves the seed from the node and shows it in a modal window.
  showSeed(wallet: WalletBase) {
    // Ask for the password and get the seed.
    PasswordDialogComponent.openDialog(this.dialog, { wallet: wallet }).componentInstance.passwordSubmit.subscribe(passwordDialog => {
      this.softwareWalletService.getWalletSeed(wallet, passwordDialog.password).subscribe(response => {
        passwordDialog.close();
        SeedModalComponent.openDialog(this.dialog, response);
      }, err => passwordDialog.error(err));
    });
  }
}
