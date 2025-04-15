import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory, { ECPairInterface } from 'ecpair'; // elliptic curve key pairs
import { execSync } from 'child_process'; // cli interaction
import * as fs from 'fs';
import { BIP32Factory } from 'bip32';  // derive HD keys
import * as ecc from 'tiny-secp256k1';
import * as bip39 from 'bip39'; // for mnemonic code 
import { networks } from 'bitcoinjs-lib';
import * as path from 'path';
import { regtest } from 'bitcoinjs-lib/src/networks';

// Initialize BIP32 and ECPair factories with secp256k1 elliptic curve cryptography
const bip32 = BIP32Factory(ecc);
const network = networks.regtest; //regtest for testing
const ECPair = ECPairFactory(ecc);

const TOTAL_KEYS = 3;
const REQUIRED_SIGNATURES = 2;
const BITCOIN_CLI_BASE = process.env.BITCOIN_CLI || 'bitcoin-cli -regtest';
const FAUCET_WALLET_NAME = 'sky-wallet';
const MULTISIG_WALLET_NAME = 'test_multisig_wallet';
const FUNDING_AMOUNT_BTC = 0.01; //amount to send to multi-sig
const FEE_RATE_SAT_PER_VBYTE = 2; // txn fee rate
const WALLET_DIR = path.join(process.env.HOME || '', '.bitcoin', 'regtest', 'wallets', MULTISIG_WALLET_NAME);
const FAUCET_WALLET_DIR = path.join(process.env.HOME || '', '.bitcoin', 'regtest', 'wallets', FAUCET_WALLET_NAME);

function runCliCommand(command: string): string {
    try {
      return execSync(command, { encoding: 'utf-8' } as const).trim();
    } catch (error: unknown) {
      const err = error as { stderr?: string; stdout?: string; message?: string };
      throw new Error(
        `Command failed: ${command}\nError: ${err.stderr ?? err.stdout ?? err.message ?? 'Unknown error'}`
      );
    }
}


/**
 * Converts an ECPairInterface to a bitcoin.Signer for PSBT signing.
 * @param keyPair The ECPairInterface containing the private-public key pair.
 * @returns A bitcoin.Signer object with public key and signing function.
 */
function toSigner(keyPair: ECPairInterface): bitcoin.Signer {
  return {
    publicKey: Buffer.from(keyPair.publicKey),
    sign: (hash: Buffer, lowR?: boolean) => Buffer.from(keyPair.sign(hash, lowR)), // signing hash with low-R
  };
}

//helper
function getErrorCode(errorMessage: string): number | null {
    const match = errorMessage.match(/error code: (-?\d+)/);
    return match ? parseInt(match[1], 10) : null;
}


//  Sleep helper that returns a promise which resolves after ms milliseconds.
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


async function bootstrap(): Promise<void> {
  console.log('🚀 Starting Multisig Wallet Bootstrap...');

  // Step 1: Generate deterministic keys from a mnemonic
  const mnemonic = 'test test test test test test test test test test test junk';
  const seed = bip39.mnemonicToSeedSync(mnemonic);// mnemonic to seed
  const root = bip32.fromSeed(seed, network); 
  const keyPairs: ECPairInterface[] = Array.from({ length: TOTAL_KEYS }, (_, i) => {
    const path = `m/44'/1'/0'/0/${i}`; // Regtest-compatible derivation path (using testnet paths) (bip44)
    const derived = root.derivePath(path);
    return ECPair.fromPrivateKey(derived.privateKey!, { network }); // Create key pair from private key
  });
  const wifs = keyPairs.map((kp) => kp.toWIF());  // Convert private keys to Wallet Import Format (WIF)
  const publicKeys = keyPairs
    .map((kp) => Buffer.from(kp.publicKey))  // extract public keys as buffer 
    .sort((a, b) => a.compare(b)); // sort public keys for consistency 
  console.log('🔑 Generated WIFs:', wifs);

  // Step 2: Create a 2-of-3 multisig address
  const p2ms = bitcoin.payments.p2ms({
    m: REQUIRED_SIGNATURES,
    pubkeys: publicKeys, // use sorted pub keys
    network,
  });
  const p2sh = bitcoin.payments.p2sh({ redeem: p2ms, network }); // wrap in P2SH
  const multisigAddress = p2sh.address!; // extract multiSig
  console.log(`🧾 2-of-3 Multisig Address: ${multisigAddress}`);

  // Step 3: Save keys and redeem script to a file
  fs.writeFileSync(
    'multisig_keys.json',
    JSON.stringify(
      { wifs, redeemScript: p2ms.output!.toString('hex'), multisigAddress }, // Store WIFs, redeem script, and address
      null,
      2
    )
  );
  console.log('💾 Saved keys to multisig_keys.json');

    // Step 4: Setup wallets for faucet and multisig, handling creation and errors
  for (const walletName of [FAUCET_WALLET_NAME, MULTISIG_WALLET_NAME]) {
    const walletDir = walletName === FAUCET_WALLET_NAME ? FAUCET_WALLET_DIR : WALLET_DIR;
    try {
      // Try to load the wallet
      runCliCommand(`${BITCOIN_CLI_BASE} loadwallet "${walletName}"`);
      console.log(`✅ Wallet ${walletName} loaded successfully.`);

      // For the multisig wallet, verify if it's watch-only(no private keys). If not, unload and recreate.
      if (walletName === MULTISIG_WALLET_NAME) {
        const walletInfo = JSON.parse(
          runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${walletName} getwalletinfo`)
        );
        if (walletInfo.private_keys_enabled) {
          console.log(`⚠️ ${walletName} is not watch-only. Unloading and recreating as watch-only...`);
          // Unload the wallet to allow re-creation
          runCliCommand(`${BITCOIN_CLI_BASE} unloadwallet "${walletName}"`);
          // Remove existing wallet directory to avoid database path error
          if (fs.existsSync(walletDir)) {
            fs.rmSync(walletDir, { recursive: true, force: true });
            console.log(`🗑️ Removed existing wallet directory: ${walletDir}`);
          }
          // Create a new watch-only wallet with descriptors=true
          runCliCommand(
            `${BITCOIN_CLI_BASE} -named createwallet wallet_name="${walletName}" disable_private_keys=true blank=false passphrase="" avoid_reuse=false descriptors=true`
          );
          console.log(`✅ Wallet ${walletName} recreated as watch-only.`);
        }
      }
    } catch (loadErr: unknown) {
      const errorMessage = (loadErr as Error).message;
      const errorCode = getErrorCode(errorMessage);
      if (errorCode === -4 || errorCode === -18) {
        console.log(`🔄 Wallet ${walletName} does not exist or directory is missing, creating...`);
        const disablePrivateKeys = walletName === MULTISIG_WALLET_NAME ? 'true' : 'false';
        // Remove existing wallet directory if it exists to prevent corruption errors
        if (fs.existsSync(walletDir)) {
          fs.rmSync(walletDir, { recursive: true, force: true });
          console.log(`🗑️ Removed existing wallet directory: ${walletDir}`);
        }
        // Ensure the parent wallets directory exists
        const parentWalletsDir = path.dirname(walletDir);
        if (!fs.existsSync(parentWalletsDir)) {
          fs.mkdirSync(parentWalletsDir, { recursive: true });
          console.log(`📁 Created parent wallets directory: ${parentWalletsDir}`);
        }
        // Create the wallet
        runCliCommand(
          `${BITCOIN_CLI_BASE} -named createwallet wallet_name="${walletName}" disable_private_keys=${disablePrivateKeys} blank=false passphrase="" avoid_reuse=false descriptors=true`
        );
        console.log(`✅ Wallet ${walletName} created and loaded successfully.`);
      } else if (errorCode === -35) {
        console.log(`✅ Wallet ${walletName} is already loaded.`);
      } else {
        throw loadErr;
      }
    }
  }

  // Step 5: Import multisig descriptor with timestamp: 0 and check success
  console.log('👀 Importing multisig descriptor...');
  const pubkeysHex = publicKeys.map((pk) => pk.toString('hex')); // pub keys to hex
  const descriptor = `sh(multi(2,${pubkeysHex.join(',')}))`; // create mutisig descriptor
  const descriptorInfo: { descriptor: string } = JSON.parse(
    runCliCommand(`${BITCOIN_CLI_BASE} getdescriptorinfo "${descriptor}"`) // get descriptor with checksum
  );
  const descriptorWithChecksum = descriptorInfo.descriptor;
  const importDescriptorsJson = JSON.stringify([
    {
      desc: descriptorWithChecksum, // Descriptor with checksum
      timestamp: 0, // Scan from genesis block
      internal: false, // Not for change addresses
      active: false, // Non-ranged descriptor (single address)
      label: `watch_${multisigAddress}`, // Label for tracking
    },
  ]);
  const importResult = runCliCommand(
    `${BITCOIN_CLI_BASE} -rpcwallet=${MULTISIG_WALLET_NAME} importdescriptors '${importDescriptorsJson}'`
  );
  const importJson: Array<{ success: boolean; error?: unknown }> = JSON.parse(importResult);
  if (!importJson[0].success) {
    throw new Error(`Failed to import descriptor: ${JSON.stringify(importJson[0].error)}`);
  }
  console.log(`✅ Imported multisig descriptor for: ${multisigAddress}`);

  // Step 6: Fund the faucet wallet by mining blocks
  console.log('💰 Funding faucet wallet...');
  const faucetAddress = runCliCommand(
    `${BITCOIN_CLI_BASE} -rpcwallet=${FAUCET_WALLET_NAME} getnewaddress "" legacy`
  );
  const blockCount = parseInt(runCliCommand(`${BITCOIN_CLI_BASE} getblockcount`), 10);
  if (blockCount < 101) {
    console.log('⛏️ Mining 101 blocks...'); // Mine initial 101 blocks for matured coins
    runCliCommand(`${BITCOIN_CLI_BASE} generatetoaddress 101 ${faucetAddress}`);
  }

  let balance = parseFloat(runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${FAUCET_WALLET_NAME} getbalance`));
  while (balance < FUNDING_AMOUNT_BTC + 0.001) {
    console.log('⛏️ Mining more blocks...'); // Mine additional blocks if balance is insufficient
    runCliCommand(`${BITCOIN_CLI_BASE} generatetoaddress 1 ${faucetAddress}`);
    balance = parseFloat(runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${FAUCET_WALLET_NAME} getbalance`));
  }
  console.log(`✅ Faucet balance: ${balance} BTC`);

  // Step 7: Send funds from faucet to multisig address to fund it
  console.log(`💸 Sending ${FUNDING_AMOUNT_BTC} BTC to multisig...`);
  const utxos: Array<{ amount: number; spendable: boolean; txid: string; vout: number }> = JSON.parse(
      runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${FAUCET_WALLET_NAME} listunspent 1`) // List UTXOs with at least 1 confirmation
  );
  const utxo = utxos.find((u) => u.amount >= FUNDING_AMOUNT_BTC + 0.001 && u.spendable); // Find a suitable UTXO
  if (!utxo) throw new Error('No suitable UTXO found in faucet wallet.');

  const txSizeEstimate = 250; // Estimated transaction size in virtual bytes
  const feeEstimate = (FEE_RATE_SAT_PER_VBYTE * txSizeEstimate) / 1e8; // Calculate fee in BTC
  const changeAmount = utxo.amount - FUNDING_AMOUNT_BTC - feeEstimate; // Calculate change
  if (changeAmount < 0) throw new Error('Insufficient funds for transaction and fee');

  const changeAddress = runCliCommand(
    `${BITCOIN_CLI_BASE} -rpcwallet=${FAUCET_WALLET_NAME} getnewaddress "" legacy` // Get a change address
  );
  const rawTxInputs = JSON.stringify([{ txid: utxo.txid, vout: utxo.vout }]); // Define transaction inputs
  const rawTxOutputs = JSON.stringify({
    [multisigAddress]: FUNDING_AMOUNT_BTC, // Output to multisig
    [changeAddress]: parseFloat(changeAmount.toFixed(8)), // Change output
  });

  const rawTx = runCliCommand(`${BITCOIN_CLI_BASE} createrawtransaction '${rawTxInputs}' '${rawTxOutputs}'`); // Create raw transaction
  const signedTx: { complete: boolean; hex: string } = JSON.parse(
    runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${FAUCET_WALLET_NAME} signrawtransactionwithwallet "${rawTx}"`) // Sign transaction
  );
  if (!signedTx.complete) throw new Error('Transaction signing failed.');

  const txid = runCliCommand(`${BITCOIN_CLI_BASE} sendrawtransaction "${signedTx.hex}"`); // Broadcast transaction
  console.log(`✅ Funding TXID: ${txid}`);

  // Step 8: Mine an extra block to confirm the funding transaction
  console.log('⛏️ Confirming transaction...');
  runCliCommand(`${BITCOIN_CLI_BASE} generatetoaddress 1 ${faucetAddress}`);
  const txDetails: { confirmations: number } = JSON.parse(
    runCliCommand(`${BITCOIN_CLI_BASE} getrawtransaction "${txid}" true`)
  );
  if (txDetails.confirmations < 1) {
    throw new Error(`Funding transaction ${txid} not confirmed.`);
  }
  console.log(`✅ Transaction ${txid} confirmed with ${txDetails.confirmations} confirmation(s).`);

  // Step 8.5: Rescan the multisig wallet and verify sync
  console.log('🔄 Rescanning multisig wallet...');
  runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${MULTISIG_WALLET_NAME} rescanblockchain`);
  const nodeBlockCount = parseInt(runCliCommand(`${BITCOIN_CLI_BASE} getblockcount`), 10);
  const walletBlockCount = parseInt(
    runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${MULTISIG_WALLET_NAME} getblockcount`),
    10
  );
  if (nodeBlockCount !== walletBlockCount) {
    throw new Error(
      `Wallet block count (${walletBlockCount}) does not match node (${nodeBlockCount}).`
    );
  }
  console.log(`✅ Multisig wallet synced to block ${walletBlockCount}.`);

  // Step 9: Poll for the multisig UTXO to appear (up to 10 attempts)
  let multisigUtxos: Array<{ amount: number; address: string; txid: string; vout: number }> = [];
  let attempts = 0;
  while (attempts < 10) {
    multisigUtxos = JSON.parse(
      runCliCommand(`${BITCOIN_CLI_BASE} -rpcwallet=${MULTISIG_WALLET_NAME} listunspent 0`)
    );
    console.log(`ℹ️ UTXOs found (attempt ${attempts + 1}):`, multisigUtxos);
    if (
      multisigUtxos.some(
        (u) => Math.abs(u.amount - FUNDING_AMOUNT_BTC) < 0.0001 && u.address === multisigAddress
      )
    ) {
      break;
    }
    console.log(`⏳ Waiting for multisig UTXO to appear (attempt ${attempts + 1}/10)...`);
    attempts++;
    await sleep(1000);
  }

  const received = multisigUtxos.some(
    (u) => Math.abs(u.amount - FUNDING_AMOUNT_BTC) < 0.0001 && u.address === multisigAddress
  );
  if (!received) {
    throw new Error('Funding transaction not visible in multisig wallet after rescan.');
  }
  console.log('🎉 Multisig funded successfully!');

  // Step 10: Spend from multisig back to faucet
  console.log('💸 Spending from multisig...');
  const spendUtxo = multisigUtxos.find((u) => u.address === multisigAddress);
  if (!spendUtxo) throw new Error('No multisig UTXO found to spend.');

  // Fetch the full raw transaction corresponding to the UTXO
  const rawPrevTx = runCliCommand(`${BITCOIN_CLI_BASE} getrawtransaction ${spendUtxo.txid}`);

  // Build the PSBT with the necessary nonWitnessUtxo field
  const psbt = new bitcoin.Psbt({ network })
    .addInput({
      hash: spendUtxo.txid,
      index: spendUtxo.vout,
      redeemScript: p2ms.output!,
      nonWitnessUtxo: Buffer.from(rawPrevTx, 'hex'),
    })
    .addOutput({
      address: runCliCommand(
        `${BITCOIN_CLI_BASE} -rpcwallet=${FAUCET_WALLET_NAME} getnewaddress "" legacy`
      ),
      value: Math.floor((spendUtxo.amount - 0.0001) * 1e8), // Deduct fee of 0.0001 BTC
    });

  // Sign with the required number of keys
  for (let i = 0; i < REQUIRED_SIGNATURES; i++) {
    psbt.signInput(0, toSigner(keyPairs[i]));
  }
  psbt.finalizeAllInputs();
  const spendTxid = runCliCommand(
    `${BITCOIN_CLI_BASE} sendrawtransaction "${psbt.extractTransaction().toHex()}"`
  );
  console.log(`✅ Multisig Spend TXID: ${spendTxid}`);

  // Step 11: Confirm the spending transaction by mining a block
  runCliCommand(`${BITCOIN_CLI_BASE} generatetoaddress 1 ${faucetAddress}`);
  console.log('✅ Bootstrap complete.');
}

// Execute the bootstrap function
bootstrap().catch((err: unknown) => {
  console.error('💥 Error:', err);
  process.exit(1);
});
