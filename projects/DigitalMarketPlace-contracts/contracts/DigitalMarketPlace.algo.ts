import { Contract } from '@algorandfoundation/tealscript';

type forSaleId = { owner: Address; asset: AssetID; nonce: uint64 };
type forSaleInfo = { deposited: uint64; unitaryPrice: uint64 };

/**
 * key -> value === (Address, uInt64, uInt64) -> (uInt64, uInt64)
 * (32 + 8 + 8) -> (8 + 8)
 * 48 -> 16
 * total = 64B
 */

// 0.0025 per box created(2_500 micro algos)
// 0.0004 per byte in box(400 micro algos)

// per box created: 25_600 micro algos

const forSaleMbr: number = 2_500 + 400 * 64;

export class DigitalMarketPlace extends Contract {
  listings = BoxMap<forSaleId, forSaleInfo>();

  /**
   * Opt the contract into the asset
   *
   * @param mbrTxn The payment transaction that pays for the Minimum Balance Requirement
   * @param asset The assetId of the asset that that want to be opted in
   */
  public allowAsset(mbrPay: PayTxn, asset: AssetID): void {
    /* this ensures that the asset has not already been opted in by a user */
    assert(!this.app.address.isOptedInToApp(asset));

    verifyPayTxn(mbrPay, {
      receiver: this.app.address,
      amount: globals.assetCreateMinBalance,
    });

    /* this opts in to the contract */
    sendAssetTransfer({
      xferAsset: asset,
      assetAmount: 0,
      assetReceiver: this.app.address,
    });
  }

  /**
   *First deposit of asset into the contract
   *
   * @param mbrPay Transaction that pays for the box storage
   * @param xfer Asset transfer txn
   * @param nonce nonce of asset listed
   * @param unitaryPrice unitary price of asset listed
   */
  public firstDeposit(mbrPay: PayTxn, xfer: AssetTransferTxn, nonce: uint64, unitaryPrice: uint64) {
    assert(!this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce }).exists);

    verifyPayTxn(mbrPay, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: forSaleMbr,
    });

    verifyAssetTransferTxn(xfer, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      assetAmount: { greaterThan: 0 },
    });

    this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce }).value = {
      deposited: xfer.assetAmount,
      unitaryPrice,
    };
  }

  /**
   *Deposit asset ito contract
   *
   * @param xfer Asset transfer txn
   * @param nonce nonce of asset listed
   */
  public deposit(xfer: AssetTransferTxn, nonce: uint64): void {
    assert(this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce }).exists);

    verifyAssetTransferTxn(xfer, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      assetAmount: { greaterThan: 0 },
    });

    const currentListing = this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce }).value;

    this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce }).value = {
      deposited: currentListing.deposited + xfer.assetAmount,
      unitaryPrice: currentListing.unitaryPrice,
    };
  }

  /**
   *Set/Update unitary price
   *
   * @param asset
   * @param nonce
   * @param unitaryPrice
   */
  public setUnitaryPrice(asset: AssetID, nonce: uint64, unitaryPrice: uint64): void {
    const currentDeposit = this.listings({ owner: this.txn.sender, asset, nonce }).value.deposited;

    this.listings({ owner: this.txn.sender, asset, nonce }).value = {
      deposited: currentDeposit,
      unitaryPrice,
    };
  }

  public buy(owner: Address, asset: AssetID, nonce: uint64, buyPay: PayTxn, quantity: uint64): void {
    const currentListing = this.listings({ owner, asset, nonce }).value;

    const amountToBePaid = wideRatio([currentListing.unitaryPrice, quantity], [10 ** asset.decimals]);

    verifyPayTxn(buyPay, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: amountToBePaid,
    });

    sendAssetTransfer({
      xferAsset: asset,
      assetReceiver: this.txn.sender,
      assetAmount: quantity,
    });

    this.listings({ owner, asset, nonce }).value = {
      deposited: currentListing.deposited - quantity,
      unitaryPrice: currentListing.unitaryPrice,
    };
  }

  /**
   *Withdraw unsold assets/collect mbr used to create box
   *
   * @param asset
   * @param nonce
   */
  public withdraw(asset: AssetID, nonce: uint64) {
    const currentListing = this.listings({ owner: this.txn.sender, asset, nonce }).value;

    this.listings({ owner: this.txn.sender, asset, nonce }).delete();

    sendPayment({ receiver: this.txn.sender, amount: forSaleMbr });

    sendAssetTransfer({ xferAsset: asset, assetReceiver: this.txn.sender, assetAmount: currentListing.deposited });
  }
}
