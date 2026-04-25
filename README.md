# ReSect

ReSect (**RE**entrancy dis**SECT**or) is an automated reentrancy transaction analysis tool for EVM-compatible blockchains. Given a transaction hash, it fetches the execution trace, detects reentrancy patterns in the call tree, and classifies the attack by **scope** (single-function, cross-function, cross-contract) and **entry point type** (fallback, malicious token, ERC hook, application hook).

## How It Works

ReSect processes a transaction through five pipeline stages:

1. **Trace Fetching** — retrieves the `debug_traceTransaction` call tree (falls back to `trace_transaction` flat traces).
2. **Address Resolution** — queries Etherscan to determine if each address is an EOA or contract, then resolves the ultimate deployer ("author") of each contract via a union-find algorithm to group related contracts.
3. **Reentrancy Detection** — walks the call tree depth-first, tracking contract visit counts per group. Reentrancy is detected when a victim-group contract is re-entered after control flows to an attacker-controlled contract.
4. **Annotation** — labels each trace entry as `VictimOut`, `AttackerIn`, `AttackerOut`, or `VictimIn`.
5. **Classification** — determines the reentrancy scope by comparing function selectors across re-entries, and classifies entry points by matching selectors against ERC standard hooks (ERC-223/677/721/777/1155/1363).

## Supported Chains

Ethereum, Arbitrum One/Nova, Avalanche C-Chain, Base, BNB Smart Chain, Blast, Celo, Cronos, Gnosis, Linea, Mantle, Moonbeam, Moonriver, Optimism, Polygon, Scroll, Sonic, zkSync, and [many more](src/config/Chain.ts) (35+ mainnets and testnets).

## Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/)
- PostgreSQL (optional — required for database caching and evaluation scripts)

## Environment Setup

Create a `.env` file in the project root:

```env
# Etherscan API key (required)
ETHERSCAN_API_KEY=your_key_here
# Multiple keys supported: ETHERSCAN_API_KEY_1, ETHERSCAN_API_KEY_2, ...
# Optional tier labels:   ETHERSCAN_API_TIER_1=pro

# Trace provider — pick one:
# Option A: QuickNode
QUICKNODE_ENDPOINT=https://...
QUICKNODE_TOKEN=your_token

# Option B: Tenderly (per-chain)
TENDERLY_ACCESS_KEY_ETHEREUM=your_key

# PostgreSQL (optional, defaults shown)
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_DATABASE=reentrancy-attack
```

## Installation

```bash
pnpm install
```

## Usage

### Analyze a transaction

```bash
pnpm start <tx-hash> [options]
```

| Option          | Description                                               | Default        |
| --------------- | --------------------------------------------------------- | -------------- |
| `--chain, -c`   | Chain name or ID                                          | `1` (Ethereum) |
| `--no-database` | Skip database caching                                     | —              |
| `--early-exit`  | Report reentrancy immediately without full trace analysis | `false`        |

Example:

Run on ChainPaint reentrancy attack (Feb 2024).

```bash
pnpm start 0x0eb8f8d148508e752d9643ccf49ac4cb0c21cbad346b5bbcf2d06974d31bd5c4 --chain Ethereum
pnpm start 0x0eb8f8d148508e752d9643ccf49ac4cb0c21cbad346b5bbcf2d06974d31bd5c4 --chain 56 --no-database
```

Example output

```
Attackers: 2 addresses
	[EOA] 0x145766a51ae96e69810fe76f6f68fd0e95675a0b
	[Contract] 0x8d4de2bc1a566b266bd4b387f62c21e15474d12a <- 0x145766a51ae96e69810fe76f6f68fd0e95675a0b (2024-02-12 11:10:35)
Victims: 1 addresses
	[Contract] 0x52d69c67536f55efefe02941868e5e762538dbd6 <- 0x28d808550ed0a9a15bd3b9103664b8c12abfa740 (2024-02-12 02:39:35)

Scope: SingleFunction
Trace Index: 124
Trace Stack: 2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1
Entrances: 40 entries
	[Fallback] 0x52d69c67536f55efefe02941868e5e762538dbd6 CALL 0x8d4de2bc1a566b266bd4b387f62c21e15474d12a (fallback)
...
```

### Run evaluation

Requires a PostgreSQL database populated with the attack dataset. The database is available at [Zenodo: Dataset and Reproducibility for ReSect: A Tool for Automated Analysis of Reentrancy Transactions on Blockchains](https://zenodo.org/records/19208343)

```bash
pnpm run evaluate:first   # False negative eval — one tx per attack
pnpm run evaluate:all     # False negative eval — all attack txs
pnpm run evaluate:fp      # False positive eval
```

### Build and test

```bash
pnpm run build   # TypeScript compilation
pnpm test        # Run all tests (requires .env credentials and network access)
```

## Architecture

```
src/
├── config/        # Chain definitions, ERC ABIs, API credentials
├── converters/    # Bidirectional conversions between API/DB/trace formats
├── core/          # Analyzer, Traverser, reentrancy detection logic
├── database/      # TypeORM entities and database access layer
├── providers/     # Etherscan, QuickNode, Tenderly RPC providers
└── utils/         # Hex branded types, EVM helpers, fetch utilities
tasks/             # CLI entry points (main, evaluation, export)
test/              # Integration tests against real transactions
```

## License

This project is licensed under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0).
