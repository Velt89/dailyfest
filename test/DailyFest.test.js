const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;

async function currentDay() {
  const ts = await time.latest();
  return Math.floor(ts / DAY);
}

// Move to a point safely inside the target UTC day number.
async function gotoDay(dayNum) {
  await time.increaseTo(dayNum * DAY + 3600);
}

describe("DailyFest", function () {
  let registry, fest, holderA, holderB, nonHolder;

  beforeEach(async function () {
    [, holderA, holderB, nonHolder] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockAgentID");
    registry = await Mock.deploy();
    const Fest = await ethers.getContractFactory("DailyFest");
    fest = await Fest.deploy(await registry.getAddress());
    await registry.setHolder(holderA.address, true);
    await registry.setHolder(holderB.address, true);
  });

  it("menu is baked in, in the exact order", async function () {
    const names = [
      "Rendang", "Sate Ayam", "Nasi Goreng", "Bakso", "Martabak Manis",
      "Ramen", "Sushi", "Tacos", "Pizza", "Burger",
      "Dim Sum", "BBQ Ribs", "Croissant", "Es Krim",
    ];
    for (let day = 0; day < 14; day++) {
      const [idx, dishName] = await fest.dishOfDay(day);
      expect(idx).to.equal(day);
      expect(dishName).to.equal(names[day]);
    }
    // wraps every 14 days
    const [idx14, name14] = await fest.dishOfDay(14);
    expect(idx14).to.equal(0);
    expect(name14).to.equal("Rendang");
    expect(await fest.dishIndexOfDay(27)).to.equal(13n);
    const [tIdx, tName, tDay] = await fest.todaysDish();
    expect(tDay).to.equal(BigInt(await currentDay()));
    expect(tIdx).to.equal(BigInt(await currentDay()) % 14n);
    expect(tName).to.equal(names[Number(tIdx)]);
  });

  it("non-holder mint reverts", async function () {
    await expect(fest.connect(nonHolder).mintDish()).to.be.revertedWith(
      "sender holds no Agent ID"
    );
    expect(await fest.canMintToday(nonHolder.address)).to.equal(false);
    expect(await fest.hasAgentId(holderA.address)).to.equal(true);
    expect(await fest.hasAgentId(nonHolder.address)).to.equal(false);
  });

  it("holder mints today's dish: kind, streak, shelf, festgoers", async function () {
    const day = await currentDay();
    const dish = day % 14;
    await expect(fest.connect(holderA).mintDish())
      .to.emit(fest, "DishMinted")
      .withArgs(holderA.address, BigInt(day), dish, 1n, 0n)
      .and.to.emit(fest, "Transfer")
      .withArgs(ethers.ZeroAddress, holderA.address, 0n);

    expect(await fest.ownerOf(0)).to.equal(holderA.address);
    expect(await fest.balanceOf(holderA.address)).to.equal(1n);
    expect(await fest.tokenKind(0)).to.equal(0);
    expect(await fest.tokenDish(0)).to.equal(dish);
    const [cur, best, life] = await fest.streakOf(holderA.address);
    expect(cur).to.equal(1n);
    expect(best).to.equal(1n);
    expect(life).to.equal(1n);
    expect(await fest.uniqueFestgoers()).to.equal(1n);
    expect(await fest.festgoersCount()).to.equal(1n);
    expect(await fest.totalMinted()).to.equal(1n);
    expect(await fest.hasDish(holderA.address, dish)).to.equal(true);
    expect(await fest.distinctDishesOf(holderA.address)).to.equal(1n);
    expect(await fest.lastMintDayOf(holderA.address)).to.equal(BigInt(day));
    expect(await fest.canMintToday(holderA.address)).to.equal(false);
  });

  it("same-day remint reverts", async function () {
    await fest.connect(holderA).mintDish();
    await expect(fest.connect(holderA).mintDish()).to.be.revertedWith("Already minted today");
  });

  it("next day: streak 2 and the next dish", async function () {
    const day = await currentDay();
    await fest.connect(holderA).mintDish();
    await gotoDay(day + 1);
    await fest.connect(holderA).mintDish();
    const [cur, best, life] = await fest.streakOf(holderA.address);
    expect(cur).to.equal(2n);
    expect(best).to.equal(2n);
    expect(life).to.equal(2n);
    expect(await fest.tokenDish(1)).to.equal((day + 1) % 14);
    expect(await fest.distinctDishesOf(holderA.address)).to.equal(2n);
    expect(await fest.canMintToday(holderA.address)).to.equal(false);
  });

  it("skipping a day resets the current streak but keeps best + lifetime", async function () {
    const day = await currentDay();
    await fest.connect(holderA).mintDish();
    await gotoDay(day + 1);
    await fest.connect(holderA).mintDish(); // streak 2
    await gotoDay(day + 3); // skip day+2
    await fest.connect(holderA).mintDish(); // streak resets
    const [cur, best, life] = await fest.streakOf(holderA.address);
    expect(cur).to.equal(1n);
    expect(best).to.equal(2n);
    expect(life).to.equal(3n);
  });

  it("collecting the same dish again after 14 days does not double-count the shelf", async function () {
    const day = await currentDay();
    await fest.connect(holderA).mintDish(); // dish = day % 14
    expect(await fest.distinctDishesOf(holderA.address)).to.equal(1n);
    await gotoDay(day + 14); // same dish again
    await fest.connect(holderA).mintDish();
    expect(await fest.tokenDish(1)).to.equal(day % 14);
    expect(await fest.distinctDishesOf(holderA.address)).to.equal(1n);
    expect(await fest.balanceOf(holderA.address)).to.equal(2n);
    const [cur, , life] = await fest.streakOf(holderA.address);
    expect(cur).to.equal(1n);
    expect(life).to.equal(2n);
  });

  it("badge claims: too early reverts, Bronze at best streak 3, re-claim reverts", async function () {
    await expect(fest.connect(holderA).claimBadge(1)).to.be.revertedWith(
      "streak too short for this badge"
    );
    const day = await currentDay();
    await fest.connect(holderA).mintDish();
    await gotoDay(day + 1);
    await fest.connect(holderA).mintDish();
    await gotoDay(day + 2);
    await fest.connect(holderA).mintDish(); // streak 3

    await expect(fest.connect(holderA).claimBadge(1))
      .to.emit(fest, "BadgeClaimed")
      .withArgs(holderA.address, 1, 3n);
    expect(await fest.tokenKind(3)).to.equal(1);
    expect(await fest.badgeClaimed(holderA.address, 1)).to.equal(true);
    await expect(fest.connect(holderA).claimBadge(1)).to.be.revertedWith(
      "badge already claimed"
    );
    // Silver still out of reach at best streak 3
    await expect(fest.connect(holderA).claimBadge(2)).to.be.revertedWith(
      "streak too short for this badge"
    );
  });

  it("badges are claimable off BEST streak even after the streak breaks", async function () {
    const day = await currentDay();
    await fest.connect(holderA).mintDish();
    await gotoDay(day + 1);
    await fest.connect(holderA).mintDish();
    await gotoDay(day + 2);
    await fest.connect(holderA).mintDish(); // best streak 3
    await gotoDay(day + 6); // long gap; never minted since
    await fest.connect(holderA).claimBadge(1);
    expect(await fest.badgeClaimed(holderA.address, 1)).to.equal(true);
  });

  it("Silver at 7 and Gold at 14 via time travel", async function () {
    const day = await currentDay();
    await fest.connect(holderA).mintDish(); // day, streak 1
    for (let d = 1; d <= 13; d++) {
      await gotoDay(day + d);
      await fest.connect(holderA).mintDish();
    }
    const [cur, best, life] = await fest.streakOf(holderA.address);
    expect(cur).to.equal(14n);
    expect(best).to.equal(14n);
    expect(life).to.equal(14n);
    await fest.connect(holderA).claimBadge(2);
    await fest.connect(holderA).claimBadge(3);
    expect(await fest.badgeClaimed(holderA.address, 2)).to.equal(true);
    expect(await fest.badgeClaimed(holderA.address, 3)).to.equal(true);
    // 14 mints (ids 0-13) + 2 badges
    expect(await fest.totalMinted()).to.equal(16n);
    expect(await fest.tokenKind(14)).to.equal(2);
    expect(await fest.tokenKind(15)).to.equal(3);
  });

  it("badge tiers 0 and 4 revert", async function () {
    await expect(fest.connect(holderA).claimBadge(0)).to.be.revertedWith("invalid tier");
    await expect(fest.connect(holderA).claimBadge(4)).to.be.revertedWith("invalid tier");
  });

  it("tokens are soulbound: transfers and approvals revert", async function () {
    await fest.connect(holderA).mintDish();
    await expect(
      fest.connect(holderA).transferFrom(holderA.address, holderB.address, 0)
    ).to.be.revertedWith("DailyFest: soulbound - transfers disabled");
    await expect(
      fest.connect(holderA)["safeTransferFrom(address,address,uint256)"](holderA.address, holderB.address, 0)
    ).to.be.revertedWith("DailyFest: soulbound - transfers disabled");
    await expect(
      fest
        .connect(holderA)
        ["safeTransferFrom(address,address,uint256,bytes)"](holderA.address, holderB.address, 0, "0x")
    ).to.be.revertedWith("DailyFest: soulbound - transfers disabled");
    await expect(fest.connect(holderA).approve(holderB.address, 0)).to.be.revertedWith(
      "DailyFest: soulbound - approvals disabled"
    );
    expect(await fest.ownerOf(0)).to.equal(holderA.address);
  });

  it("getFestgoers paginates and lists each festgoer once", async function () {
    await fest.connect(holderA).mintDish();
    await fest.connect(holderB).mintDish();
    expect(await fest.uniqueFestgoers()).to.equal(2n);
    expect(await fest.getFestgoers(0, 1)).to.deep.equal([holderA.address]);
    expect(await fest.getFestgoers(1, 1)).to.deep.equal([holderB.address]);
    expect(await fest.getFestgoers(0, 100)).to.deep.equal([holderA.address, holderB.address]);
    expect(await fest.getFestgoers(5, 10)).to.deep.equal([]);
    // a second-day mint does not duplicate the entry
    const day = await currentDay();
    await gotoDay(day + 1);
    await fest.connect(holderA).mintDish();
    expect(await fest.uniqueFestgoers()).to.equal(2n);
  });

  it("tokenURI is base64 JSON with the dish name / badge tier", async function () {
    const day = await currentDay();
    await fest.connect(holderA).mintDish();
    const uri = await fest.tokenURI(0);
    const prefix = "data:application/json;base64,";
    expect(uri.startsWith(prefix)).to.equal(true);
    const json = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
    const [, dishName] = await fest.dishOfDay(day);
    expect(json.name).to.equal(`Daily Fest — ${dishName}`);
    expect(json.image).to.contain("dailyfest@main/frontend/public/dishes/");
    const dishAttr = json.attributes.find((a) => a.trait_type === "Dish");
    expect(dishAttr.value).to.equal(dishName);

    // badge tokenURI
    await gotoDay(day + 1);
    await fest.connect(holderA).mintDish();
    await gotoDay(day + 2);
    await fest.connect(holderA).mintDish();
    await fest.connect(holderA).claimBadge(1);
    const bUri = await fest.tokenURI(3);
    const bJson = JSON.parse(Buffer.from(bUri.slice(prefix.length), "base64").toString("utf8"));
    expect(bJson.name).to.equal("Daily Fest — Bronze Feast Badge");
    expect(bJson.image).to.contain("badge-bronze.svg");
  });

  it("supportsInterface reports ERC-165 / ERC-721 / metadata", async function () {
    expect(await fest.supportsInterface("0x01ffc9a7")).to.equal(true);
    expect(await fest.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await fest.supportsInterface("0x5b5e139f")).to.equal(true);
    expect(await fest.supportsInterface("0xffffffff")).to.equal(false);
  });
});
