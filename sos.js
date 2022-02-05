require('dotenv').config();

const { ethers } = require("ethers");
const { formatEther, parseEther } = require("ethers/lib/utils");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const SOS_ABI = require("./abi/OpenDAO.json");
const SOS_ADDRESS = "0x3b484b82567a09e2588A13D54D032153f0c0aEe0";
const SOS_START_BLOCK = 13860522;

const SNAPSHOT_BLOCK = 13858107;

const csvWriterAll = createCsvWriter({
  path: "sos_all_claims.csv",
  header: [
    {id: "wallet", title: "Wallet"},
    {id: "amount", title: "Amount"},
    {id: "txHash", title: "Tx Hash"},
  ],
  append: true,
})

let provider;

const main = async () => {
  provider = new ethers.providers.WebSocketProvider(process.env.WS_NODE_URI);
  const contract = getSOSContract(provider);

  const startBlock = 12776259;
  const lastBlock = await provider.getBlockNumber();
  const endBlock = Math.min(startBlock + 60000, lastBlock);
  const interval = 10000;


  for (let i = startBlock; i < endBlock; i += interval) {
    const _endBlock = Math.min(endBlock, i + interval);
    console.log(`------ Scanning Block ${i + 1} to ${_endBlock} ----------`);
    await sleep(100);
    const task = parseClaims;
    const doTask = (tries) => {
      task(contract, i + 1, _endBlock)
        .then(() => {})
        .catch(async (error) => {
          console.log("error occured:", error)
          if (tries < 2) {
            await sleep(Math.random() * 3000)
            tries += 1;
            doTask(tries)
          }
        })
    };

    doTask()
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const getSOSContract = (provider) => {
  const contract = new ethers.Contract(SOS_ADDRESS, SOS_ABI, provider);
  return contract;
}

const parseClaims = async (contract, startBlock, endBlock) => {
  console.log(`------ Scanning Block ${startBlock} to ${endBlock} ----------`);
  const filter = contract.filters.Transfer(ethers.constants.AddressZero);
  const claimEvents = await contract.queryFilter(filter, startBlock, endBlock);
  console.log(`[${startBlock} - ${endBlock}] Found ${claimEvents.length} claims`);

  let data = []

  for (const event of claimEvents) {
    const wallet = event.args.to;
    const amount = formatEther(event.args.value);
    const txHash = event.transactionHash
    data.push({wallet, amount, txHash})
  }

  console.log(`[${startBlock} - ${endBlock}] Writing ${data.length} claim event`);
  if (data.length > 0) {
    await csvWriterAll.writeRecords(data)
  }
}


main()
