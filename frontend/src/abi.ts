// Minimal ABIs — only the functions/events this app uses.
// Registry ABI subset confirmed against the verified registry ABI.

export const registryAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "handleOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "string" }],
  },
] as const;

export const dailyFestAbi = [
  {
    type: "function",
    name: "hasAgentId",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "mintDish",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimBadge",
    stateMutability: "nonpayable",
    inputs: [{ name: "tier", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "todaysDish",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "index", type: "uint8" },
      { name: "dishName", type: "string" },
      { name: "day", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "dishOfDay",
    stateMutability: "view",
    inputs: [{ name: "day", type: "uint256" }],
    outputs: [
      { name: "index", type: "uint8" },
      { name: "dishName", type: "string" },
    ],
  },
  {
    type: "function",
    name: "streakOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "current", type: "uint256" },
      { name: "best", type: "uint256" },
      { name: "lifetime", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "canMintToday",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "lastMintDayOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "badgeClaimed",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "hasDish",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "dishIndex", type: "uint8" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "distinctDishesOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "uniqueFestgoers",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getFestgoers",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "event",
    name: "DishMinted",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "day", type: "uint256", indexed: true },
      { name: "dishIndex", type: "uint8", indexed: false },
      { name: "streak", type: "uint256", indexed: false },
      { name: "tokenId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BadgeClaimed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "tokenId", type: "uint256", indexed: false },
    ],
  },
] as const;
