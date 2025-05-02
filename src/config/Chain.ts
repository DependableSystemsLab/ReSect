export enum Mainnet {
	Ethereum = 1,
	Abstract = 2741,
	ApeChain = 33139,
	ArbitrumNova = 42170,
	ArbitrumOne = 42161,
	AvalancheCChain = 43114,
	Base = 8453,
	Berachain = 80094,
	BitTorrentChain = 199,
	Blast = 81457,
	BNBSmartChain = 56,
	Celo = 42220,
	Cronos = 25,
	Fraxtal = 252,
	Gnosis = 100,
	Linea = 59144,
	Mantle = 5000,
	Memecore = 4352,
	Moonbeam = 1284,
	Moonriver = 1285,
	Optimism = 10,
	Polygon = 137,
	PolygonzkEVM = 1101,
	Scroll = 534352,
	Sonic = 146,
	Sophon = 50104,
	Swellchain = 1923,
	Taiko = 167000,
	Unichain = 130,
	WEMIX3 = 1111,
	World = 480,
	Xai = 660279,
	XDC = 50,
	zkSync = 324
}

export enum Testnet {
	EthereumSepolia = 11155111,
	EthereumHolesky = 17000,
	AbstractSepolia = 11124,
	ApeChainCurtis = 33111,
	ArbitrumSepolia = 421614,
	AvalancheFuji = 43113,
	BaseSepolia = 84532,
	BerachainBepolia = 80069,
	BitTorrentChain = 1028,
	BlastSepolia = 168587773,
	BNBSmartChain = 97,
	CeloAlfajores = 44787,
	Fraxtal = 2522,
	LineaSepolia = 59141,
	MantleSepolia = 5003,
	Memecore = 43521,
	MoonbaseAlpha = 1287,
	OptimismSepolia = 11155420,
	PolygonAmoy = 80002,
	PolygonzkEVMCardona = 2442,
	ScrollSepolia = 534351,
	SonicBlaze = 57054,
	SophonSepolia = 531050104,
	Swellchain = 1924,
	TaikoHeklaL2 = 167009,
	UnichainSepolia = 1301,
	WEMIX3 = 1112,
	WorldSepolia = 4801,
	XaiSepolia = 37714555429,
	XDCApothem = 51,
	zkSyncSepolia = 300
}

export type Chain = Mainnet | Testnet;

export type ChainName = keyof typeof Mainnet | keyof typeof Testnet;

const chainNames_ = new Map<number, ChainName>();
Object.entries(Mainnet).forEach(([name, id]) => chainNames_.set(id as Mainnet, name as keyof typeof Mainnet));
Object.entries(Testnet).forEach(([name, id]) => chainNames_.set(id as Testnet, name as keyof typeof Testnet));
export const chainNames = chainNames_ as ReadonlyMap<number, ChainName>;