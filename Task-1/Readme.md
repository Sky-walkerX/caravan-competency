# Bitcoin Multisig Bootstrap Project

This repository contains a TypeScript script (`src/bootstrap.multisig.ts`) to bootstrap a 2-of-3 multisig wallet setup on the Bitcoin regtest network. The script generates deterministic keys, creates a multisig address (P2SH), funds it from a faucet wallet, and optionally demonstrates a spending transaction. This is intended for development and testing purposes only.

## Table of Contents
- [Requirements](#requirements)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Script](#running-the-script)
- [Steps Performed by the Script](#steps-performed-by-the-script)
- [Output](#output)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [License](#license)

## Requirements
- **Node.js**: Version 16.x or higher (recommended: LTS version).
- **TypeScript**: Version 4.x or higher.
- **Bitcoin Core**: Version 22.0 or higher, configured for regtest mode. Requires descriptor wallet support (enabled by default in recent versions).
- **npm** or **yarn**: For managing Node.js dependencies.

## Prerequisites
1.  **Bitcoin Core Setup**:
    *   Install Bitcoin Core (e.g., via `sudo apt install bitcoind` on Ubuntu or download from [bitcoin.org](https://bitcoin.org/)).
    *   **Important:** Create or modify your `bitcoin.conf` file for regtest (usually located at `~/.bitcoin/bitcoin.conf`):
        ```ini
        regtest=1
        server=1
        rpcuser=your_rpc_user
        rpcpassword=your_rpc_password
        ```
    *   Start Bitcoin Core in regtest mode:
        ```bash
        bitcoind -regtest -daemon
        ```
    *   Ensure the data directory (e.g., `~/.bitcoin/regtest`) is writable and has sufficient space.

2.  **Environment**:
    *   A Unix-like system (Linux, macOS) or Windows with WSL is recommended.
    *   The script assumes `bitcoin-cli` is in the system's PATH or accessible.
    *   It assumes default Bitcoin Core RPC settings (cookie authentication) unless specified otherwise in `bitcoin.conf`.

3.  **Permissions**:
    *   Ensure the user running the script has permissions to execute `bitcoin-cli` and interact with the Bitcoin Core daemon.
    *   Ensure write access to the Bitcoin Core regtest wallets directory (e.g., `~/.bitcoin/regtest/wallets/`).

## Installation
1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Sky-walkerX/caravan-competency.git
    cd caravan-competency/Task-1
    ```

2.  **Install Dependencies**:
    Using npm:
    ```bash
    npm install
    ```
    Or using yarn:
    ```bash
    yarn install
    ```

## Configuration
Most configuration is done via constants within the `src/bootstrap.multisig.ts` script:

-   `MNEMONIC`: The BIP39 mnemonic phrase used to generate master keys. **FOR TESTING ONLY**.
-   `M`: The required number of signatures (e.g., 2).
-   `N`: The total number of public keys (e.g., 3).
-   `DERIVATION_PATH`: The BIP32 derivation path for generating keys (e.g., `"m/44'/1'/0'/0/0"` - using 1' for testnet/regtest).
-   `FAUCET_WALLET_NAME`: The name for the wallet used to initially receive mined coins.
-   `MULTISIG_WALLET_NAME`: The name for the descriptor wallet that will watch the multisig address.
-   `FUNDING_AMOUNT_BTC`: The amount of BTC to send to the multisig address.
-   `NETWORK`: The `bitcoinjs-lib` network object (`bitcoin.networks.regtest`).
-   `BITCOIN_CLI_COMMAND`: The base command to run `bitcoin-cli` (e.g., `bitcoin-cli -regtest`).

Modify these constants directly in the script if needed.

## Running the Script
1.  **Compile TypeScript**:
    ```bash
    npx tsc
    ```

2.  **Run the compiled JavaScript**:
    ```bash
    node dist/bootstrap_wallet.js
    ```

    *Alternatively, run directly using `ts-node` (if installed):*
    ```bash
    npx ts-node src/bootstrap.multisig.ts
    ```

The script will execute the steps and print information to the console.

## Steps Performed by the Script
1.  **Verify Bitcoin Core**: Checks if `bitcoind` is running on regtest and accessible.
2.  **Generate Keys**: Derives `N` sets of private and public keys from the `MNEMONIC` using the specified `DERIVATION_PATH`.
3.  **Create Multisig Info**: Constructs the 2-of-3 multisig script and derives the P2SH address using `bitcoinjs-lib`.
4.  **Setup Faucet Wallet**:
    *   Creates a new descriptor wallet named `faucet_wallet` (using `createwallet` with `descriptors=true`).
    *   Generates an address within the faucet wallet.
    *   Mines 101 blocks to mature the initial coinbase reward.
5.  **Setup Multisig Watch Wallet**:
    *   Creates a new descriptor wallet named `multisig_wallet` (blank, no private keys initially).
    *   Generates the appropriate `sh(multi(...))` descriptor for the multisig address.
    *   Imports the descriptor into the `multisig_wallet` using `importdescriptors`.
6.  **Fund Multisig Address**: Sends `FUNDING_AMOUNT_BTC` from the `faucet_wallet` to the P2SH multisig address.
7.  **Confirm Funding**: Mines blocks (e.g., 6 blocks) to confirm the funding transaction.
8.  **Log Output**: Prints the mnemonic, derived keys (public), multisig address, funding transaction ID, and confirmation status.
9.  **(Optional) Demonstrate Spending**: The script includes commented-out code showing the steps to create, sign (using `signrawtransactionwithkey` with the derived private keys), combine, and broadcast a transaction spending from the multisig address. Uncomment and adapt if needed.

## Output
The script will log information to the console, including:
- Confirmation that Bitcoin Core is running.
- The generated Mnemonic (use for testing only).
- Derived Public Keys.
- The generated 2-of-3 P2SH Multisig Address.
- The name of the faucet wallet created.
- The name of the multisig watch wallet created.
- Transaction ID of the funding transaction.
- Confirmation details of the funding transaction.
- (If spending demo uncommented) TXID of the spending transaction.

Example snippet:

```bash
Bitcoin Core is running on regtest mode.
Mnemonic (for testing only): "skywalker went walk lord the last jedi luke moon walks"
Generated Public Keys:
- Key 1: xpub6A1s91j2bS5V2t96EK5E2w6NrScaZ9s1Yk6vgM8eB1p21Ch8zRrY5oaL1a9XtfeWpU7v8g9ozUetk4fgq4xK4JnbpZ5hAfQ6j1gSmeV5a"
- Key 2: xpub6DdPYj7yyYvM9uFZyHqbhyaYZ4Eut8v48j26GjFz88Ems4hNRV7KHa9Dw3zmFta5ytmmFqE4WaVse6y3QsGo6XPHEz8HvhZmpwaKfEnFhN"
- Key 3: xpub6CqCmG5rsgwFy7gXb8YZ74fqfjU6xemA4Wq3y4PRYmoLf7yDzF4VZazvUhkz9dcYvXtw3veX5z7Ed5W88MzhVkFwtkz1knk1hkmvMpoMuA"
Generated Multisig Address: 2N6j3d52z1YUk7rMmfV1fVnFYDov4rhQ4khS
Faucet Wallet Created: sky-wallet
Multisig Watch Wallet Created: multisig_wallet
Funding Transaction ID: 12ab34cd5678ef9012345678abcd5678ef9012345678abcd5678ef90123456
Funding Transaction Confirmed: 6 blocks mined
```
## Troubleshooting

### ❗ Error: Wallet already exists
If the faucet or multisig wallets already exist, remove them before rerunning the script:

```bash
rm -rf ~/.bitcoin/regtest/wallets/faucet_wallet
rm -rf ~/.bitcoin/regtest/wallets/multisig_wallet
```
### RPC Connection Error
Ensure that Bitcoin Core (bitcoind) is running, and the RPC credentials in the bitcoin.conf file are correctly set and match those in the script.

### Permission Issues
If you encounter permission errors, try running the script with elevated permissions (use sudo if necessary), or ensure your user has sufficient permissions to read/write the Bitcoin Core data directory and execute bitcoin-cli.

# Security Notes
This script and the keys generated are intended for development and testing only.

Do not use this script on the mainnet or with real funds.

Keep your mnemonic, private keys, and wallet details safe and secure.

This script assumes that the Bitcoin Core instance is running in regtest mode, which means the coins involved are not real and are only for testing purposes.
