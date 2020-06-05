import { CoinTypeFeatures } from './coin-type-features';

export class BtcFeatures implements CoinTypeFeatures {
  softwareWallets = false;
  outputs = true;
  networkingStats = false;
  showAllPendingTransactions = false;
  coinHours = false;
  limitedSendingOptions = false;
}
