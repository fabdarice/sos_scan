require('dotenv').config();

const { ethers } = require("ethers");
const { formatEther, formatUnits} = require("ethers/lib/utils");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const OPENSEA_ABI = require("./abi/OpenSea.json");
const ERC20_ABI = require("./abi/ERC20.json");
const OPENSEA_ADDRESS = "0x7Be8076f4EA4A4AD08075C2508e481d6C946D12b";
const OPENSEA_START_BLOCK = 5774644;
let provider;

const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";


const csvWriter = createCsvWriter({
  path: "opensea.csv",
  header: [
    {id: "buyer", title: "buyer"},
    {id: "seller", title: "seller"},
    {id: "amount", title: "amount"},
    {id: "token", title: "token"},
    {id: "txHash", title: "TxHash"},
    {id: "gasFee", title: "gasFee"},
    {id: "gasPrice", title: "gasPrice"},
    {id: "blockNumber", title: "block"},
    {id: "status", title: "status"},
  ],
  append: true,
})

const main = async () => {

  provider = new ethers.providers.WebSocketProvider(process.env.WS_NODE_URI);

  const opensea = new ethers.Contract(OPENSEA_ADDRESS, OPENSEA_ABI, provider);
  const startBlock = 12245029;

  const lastBlock = await provider.getBlockNumber();
  const endBlock = Math.min(startBlock + 5000, lastBlock);
  const interval = 5000;


  for (let i = startBlock; i < endBlock; i += interval) {
    let tries = 0
    const _endBlock = Math.min(endBlock, i + interval);
    console.log(`------ Scanning Block ${i} to ${_endBlock} ----------`);
    await sleep(100);
    const task = parseAtomicMatch;
    const doTask = (tries) => {
      task(opensea, i + 1, _endBlock)
        .then(() => {})
        .catch(async (error) => {
          console.log(`[${i} - ${_endBlock}] error occured:`, error)
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

const _scanEvent = async (event, opensea) => {
  let price, tokenName, isERC, buyer, seller;
  const receipt = await opensea.provider.getTransactionReceipt(event.transactionHash);
  for (const log of receipt.logs) {
    if (log.topics.length == 3
      && log.topics[0].toLowerCase() == TRANSFER_SIG.toLowerCase()
      && ethers.BigNumber.from(log.data).eq(event.args["price"])
    ) {
      const token = new ethers.Contract(log.address, ERC20_ABI, opensea.provider);
      price = formatUnits(event.args["price"], await token.decimals());
      try {
        tokenName = await token.symbol();
      } catch(err) {
        tokenName = "UNKNOWN";
      }
      isERC = true;
      buyer = ethers.BigNumber.from(log.topics[1]).toHexString();
      seller = ethers.BigNumber.from(log.topics[2]).toHexString();
      break;
    }
    if (log.topics.length == 4
      && log.topics[0].toLowerCase() == TRANSFER_SIG.toLowerCase()
      && log.data == "0x"
    ) {
      buyer = ethers.BigNumber.from(log.topics[2]).toHexString();
      seller = ethers.BigNumber.from(log.topics[1]).toHexString();
    }
  }
  buyer = buyer || event.args["taker"];
  seller = seller || event.args["maker"];
  if (isERC) {
    isERC = false;
  } else {
    price = formatEther(event.args["price"])
    tokenName = "ETH"
  }
  let gasPrice, gasFee;
  if (receipt.type == 0) {
    // LEGACY
    const tx = await opensea.provider.getTransaction(event.transactionHash);
    gasFee = tx.gasPrice;
  } else {
    // EIP-1559
    gasFee = receipt.effectiveGasPrice
  }
  gasPrice = receipt.gasUsed.mul(gasFee);
  return {
    buyer: buyer.toLowerCase(),
    seller: seller.toLowerCase(),
    amount: price,
    token: tokenName,
    txHash: event.transactionHash,
    gasFee: formatUnits(gasFee, "gwei"),
    gasPrice: formatEther(gasPrice),
    blockNumber: event.blockNumber,
    status: receipt.status,
  }
}

const parseAtomicMatch = async (opensea, startBlock, endBlock) => {
  const filter = opensea.filters.OrdersMatched()
  const events = await opensea.queryFilter(filter, startBlock, endBlock);
  console.log(`[${startBlock} - ${endBlock}] Found ${events.length} txs`)

  let data = []
  for (const event of events) {
    try {
      data.push(await _scanEvent(event, opensea))
      // csvWriter.writeRecords(res);
    }
     catch(err) {
      console.log(`Error inside [${startBlock} - ${endBlock}] ${err}`);
       try{
         await sleep(3000);
         data.push(await _scanEvent(event, opensea))
        // csvWriter.writeRecords(res);
       }
       catch(err) {
        console.log(`Error inside (2nd attempt) [${startBlock} - ${endBlock}] ${err}`);
      }
    }
  }
  if (data.length > 0) {
    await csvWriter.writeRecords(data);
  }
  console.log(`[${startBlock} - ${endBlock}] Found ${events.length} txs (Done)`)
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


main();

