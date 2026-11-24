// LOCAL ONLY gas measurement: deploys MockAgentID + DailyFest on the
// Hardhat in-process network and measures gasUsed for deploy / mintDish /
// claimBadge from transaction receipts. No live network, no keys.
const { ethers } = require("hardhat");

async function nextDay(ts) {
  const day = Math.floor(ts / 86400);
  await ethers.provider.send("evm_setNextBlockTimestamp", [(day + 1) * 86400 + 3600]);
}

(async () => {
  const [deployer, holder] = await ethers.getSigners();

  const Mock = await ethers.getContractFactory("MockAgentID");
  const mock = await Mock.deploy();
  await mock.waitForDeployment();

  const Fest = await ethers.getContractFactory("DailyFest");
  const fest = await Fest.deploy(await mock.getAddress());
  const deployReceipt = await fest.deploymentTransaction().wait();
  console.log("dailyFestDeployGasUsed:", deployReceipt.gasUsed.toString());
  console.log("dailyFestAddress(local):", await fest.getAddress());

  await (await mock.setHolder(holder.address, true)).wait();

  const mint1 = await (await fest.connect(holder).mintDish()).wait();
  console.log("mintDishGasUsed(first):", mint1.gasUsed.toString());

  let ts = (await ethers.provider.getBlock("latest")).timestamp;
  await nextDay(ts);
  const mint2 = await (await fest.connect(holder).mintDish()).wait();
  console.log("mintDishGasUsed(day2):", mint2.gasUsed.toString());

  ts = (await ethers.provider.getBlock("latest")).timestamp;
  await nextDay(ts);
  const mint3 = await (await fest.connect(holder).mintDish()).wait();
  console.log("mintDishGasUsed(day3):", mint3.gasUsed.toString());

  const badge = await (await fest.connect(holder).claimBadge(1)).wait();
  console.log("claimBadgeGasUsed(bronze):", badge.gasUsed.toString());

  const factory = await ethers.getContractFactory("DailyFest");
  const estDeploy = await factory.getDeployTransaction(await mock.getAddress());
  const est = await ethers.provider.estimateGas({ ...estDeploy, from: deployer.address });
  console.log("localEstimateGasDeploy:", est.toString());
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
