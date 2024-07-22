import express from 'express';

import { Wallet } from '@ethersproject/wallet'
import { pathToString } from '@cosmjs/crypto';

import { BigNumber, ethers } from 'ethers'
import { bech32 } from 'bech32';

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient } from "@cosmjs/stargate";

import conf from './config/config.js'
import { FrequencyChecker } from './checker.js';

// load config
console.log("loaded config: ", conf)

const app = express()

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");

const checker = new FrequencyChecker(conf)

app.use((req, res, next) => {
  const clientip = req.headers['x-real-ip'] || req.headers['X-Real-IP'] || req.headers['X-Forwarded-For'] || req.ip
  console.log(`Received ${req.method} request at ${req.url} from ${clientip}`);
  next();
});

app.get('/', (req, res) => {
  res.render('index', conf);
})

app.get('/config.json', async (req, res) => {
  const sample = {}
  for(let i =0; i < conf.blockchains.length; i++) {
    const chainConf = conf.blockchains[i]
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
    const [firstAccount] = await wallet.getAccounts();
    sample[chainConf.name] = firstAccount.address

    const wallet2 = Wallet.fromMnemonic(chainConf.sender.mnemonic, pathToString(chainConf.sender.option.hdPaths[0]));
    console.log('address:', firstAccount.address, wallet2.address)
  }

  const project = conf.project
  project.sample = sample
  project.blockchains = conf.blockchains.map(x => x.name)
  project.addressPrefix = conf.blockchains[0].sender.option.prefix
  project.reCaptchaSiteKey = conf.reCaptcha.siteKey
  res.send(project);
})

const queue = [];
const addressStatus = {};

// Enqueue address
const enqueueAddress = async (statusAddress) => {
  console.log('Enqueueing address:', statusAddress);
  if (!addressStatus[statusAddress] || addressStatus[statusAddress] === 'cleared') {
    if (!queue.includes(statusAddress)) {
      queue.push(statusAddress);
    }
  }
};

// Process addresses
const processAddresses = async (chain) => {
  console.log('Starting to process addresses');
  while (true) {
    console.log(`the lenght of the queue: ${queue.length}`);
    if (queue.length > 0) {
      const statusAddress = queue.shift();
      const address = statusAddress.replace('status:', '');
      try {
        await sendTx(address, chain);
      } catch (error) {
        console.log(error, 'error')
      }
      addressStatus[statusAddress] = 'Completed';
    }

    console.log('Waiting for 5 seconds cooldown period');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
};

processAddresses(conf.blockchains[0].name);

app.get('/balance/:chain', async (req, res) => {
  const { chain }= req.params

  let balance = {}

  try{
    const chainConf = conf.blockchains.find(x => x.name === chain)
    if(chainConf) {
      if(chainConf.type === 'Ethermint') {
        const ethProvider = new ethers.providers.JsonRpcProvider(chainConf.endpoint.evm_endpoint);
        const wallet = Wallet.fromMnemonic(chainConf.sender.mnemonic, pathToString(chainConf.sender.option.hdPaths[0])).connect(ethProvider);
        await wallet.getBalance().then(ethBlance => {
          balance = {
            denom:chainConf.tx.amount.denom,
            amount:ethBlance.toString()
          }
        }).catch(e => console.error(e))

      }else{
        const rpcEndpoint = chainConf.endpoint.rpc_endpoint;
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
        const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);
        const [firstAccount] = await wallet.getAccounts();
        await client.getBalance(firstAccount.address, chainConf.tx.amount[0].denom).then(x => {
          balance = x
        }).catch(e => console.error(e));
      }
    }
  } catch(err) {
    console.log(err)
  }
  res.send(balance);
})

const blocklist = new Set();
const ipCounter = new Map();
const TIME_WINDOW = 60000; // 1 minute in milliseconds
const MAX_REQUESTS = 3; // Threshold for blocklisting

const checkIpBlockList = async (ip) => {
    const [firstOctet, secondOctet] = ip.split('.');
    const ipPrefix = `${firstOctet}.${secondOctet}`;

    // Check if the IP prefix is in the blocklist
    if (blocklist.has(ipPrefix)) {
      return true
    }

    const now = Date.now();

    // Check and update IP counter
    if (!ipCounter.has(ipPrefix)) {
        ipCounter.set(ipPrefix, []);
    }

    const timestamps = ipCounter.get(ipPrefix);
    timestamps.push(now);

    // Remove timestamps older than 1 minute
    while (timestamps.length > 0 && now - timestamps[0] > TIME_WINDOW) {
        timestamps.shift();
    }

    // If more than 3 requests in the last minute, add to blocklist
    if (timestamps.length > MAX_REQUESTS) {
      blocklist.add(ipPrefix);
      ipCounter.delete(ipPrefix);
    } else {
        ipCounter.set(ipPrefix, timestamps);
    }

    return false
};

app.post('/send', async (req, res, next) => {
  return Promise.resolve().then(async () => {
    const {chain, address, recapcha_token} = req.body;
    // Verify recaptcha
    const recaptchaVerification = await getRecaptchaVerification(recapcha_token);
    console.log('recaptchaVerification response:', JSON.stringify(recaptchaVerification, null, 2));
    if (!recaptchaVerification.success) {
      return res.status(401).json({ code: 1, message: 'Recaptcha verification failed' });
    }

    // Process request
    const ip = req.headers['x-real-ip'] || req.headers['X-Real-IP'] || req.headers['X-Forwarded-For'] || req.ip
    console.log('request tokens to ', address, ip)
    if (chain || address ) {
      // try {
        const chainConf = conf.blockchains.find(x => x.name === chain)
        if (chainConf && (address.startsWith(chainConf.sender.option.prefix) || address.startsWith('0x'))) {
          if( await checker.checkAddress(address, chain) && await checker.checkIp(`${chain}${ip}`, chain) ) {
            checker.update(`${chain}${ip}`) // get ::1 on localhost

            const statusAddress = `status:${address}`;
            if (addressStatus[statusAddress] === 'Completed') {
              addressStatus[statusAddress] = 'cleared';
              return res.status(201).json({ code: 0, message: 'Your previous faucet request has been processed. You can now submit a new request.' });
            }

            if (queue.includes(statusAddress)) {
              console.log('Address already in queue');
              return res.status(200).json({ code: 0, message: 'Address already in the processing queue' });
            }

            const ipBlocked = await checkIpBlockList(ip);
            if (ipBlocked) {
              console.log(`IP blocked - ${ip}`);
              res.status(403).json({ code: 1, message: `IP added to blocklist.`});
            } else {
              await enqueueAddress(statusAddress);
              res.status(201).json({ code: 0, message: 'Address enqueued for faucet processing.' });
            }

            await checker.update(address)

          }else {
            res.status(429).send({ code: 1, message: `Too many faucet requests sent for address '${address}'. Try again later.
              \nLimits per 24h: ${chainConf.limit.address} times per address, ${chainConf.limit.ip} times per IP.
            `})
          }
        } else {
          res.status(400).send({ code: 1, message: `Address '${address}' is not supported.`, recipient: address })
        }
      // } catch (err) {
      //   console.error(err);
      //   res.send({ result: 'Failed, Please contact to admin.' })
      // }

    } else {
      // send result
      res.status(400).send({ code: 0, message: 'address is required' });
    }}).catch(next)
})

// 500 - Any server error
app.use((err, req, res) => {
  console.log("\nError catched by error middleware:", err.stack)
})

app.listen(conf.port, () => {
  console.log(`Faucet app listening on port ${conf.port}`)
})

async function getRecaptchaVerification(token) {
  const secret = conf.reCaptcha.secretKey;
  console.log("Fetching recaptcha verification:", `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`)
  const response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`, {
    method: 'POST',
  });
  return response.json();
}

async function sendCosmosTx(recipient, chain) {
  console.log("sendCosmosTx", recipient, chain)
  // const mnemonic = "surround miss nominee dream gap cross assault thank captain prosper drop duty group candy wealth weather scale put";
  const chainConf = conf.blockchains.find(x => x.name === chain) 
  if(chainConf) {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
    const [firstAccount] = await wallet.getAccounts();

    // console.log("sender", firstAccount);
    const rpcEndpoint = chainConf.endpoint.rpc_endpoint;
    const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);
    // const recipient = "cosmos1xv9tklw7d82sezh9haa573wufgy59vmwe6xxe5";
    const amount = chainConf.tx.amount;
    const fee = chainConf.tx.fee;
    const initialAccountBalance = await client.getBalance(recipient, chainConf.tx.amount[0].denom)
    try {
      return await client.sendTokens(firstAccount.address, recipient, amount, fee);
    } catch(e) {
      const finalAccountBalance = await client.getBalance(recipient, chainConf.tx.amount[0].denom)
      const diff = BigNumber.from(finalAccountBalance.amount).sub(BigNumber.from(initialAccountBalance.amount))
      if (!diff.eq(BigNumber.from(amount[0].amount))) {
        throw new Error(`Recipient balance did not increase by the expected amount. Error: ${e.message}`)
      }
    }
    console.log(`Sent ${amount} tokens to ${recipient}`)
    return {code: 0}
  }
  throw new Error(`Blockchain Config [${chain}] not found`)
}

async function sendEvmosTx(recipient, chain) {

  try{
    const chainConf = conf.blockchains.find(x => x.name === chain)
    const ethProvider = new ethers.providers.JsonRpcProvider(chainConf.endpoint.evm_endpoint);

    const wallet = Wallet.fromMnemonic(chainConf.sender.mnemonic).connect(ethProvider);

    let evmAddress =  recipient;
    if(recipient && !recipient.startsWith('0x')) {
      let decode = bech32.decode(recipient);
      let array = bech32.fromWords(decode.words);
      evmAddress =  "0x" + toHexString(array);
    }

    let result = await wallet.sendTransaction(
        {
          from:wallet.address,
          to:evmAddress,
          value:chainConf.tx.amount.amount
        }
      );

    let repTx = {
      "code":0,
      "nonce":result["nonce"],
      "value":result["value"].toString(),
      "hash":result["hash"]
    };

    console.log("xxl result : ",repTx);
    return repTx;
  }catch(e){
    console.log("xxl e ",e);
    return e;
  }

}

function toHexString(bytes) {
  return bytes.reduce(
      (str, byte) => str + byte.toString(16).padStart(2, '0'),
      '');
}

async function sendTx(recipient, chain) {
  const chainConf = conf.blockchains.find(x => x.name === chain)
  if(chainConf.type === 'Ethermint') {
    return sendEvmosTx(recipient, chain)
  }
  return sendCosmosTx(recipient, chain)
}

// write a function to send evmos transaction
async function sendEvmosTx2(recipient, chain) {

  // use evmosjs to send transaction
  const chainConf = conf.blockchains.find(x => x.name === chain)
  // create a wallet instance
  const wallet = Wallet.fromMnemonic(chainConf.sender.mnemonic).connect(chainConf.endpoint.evm_endpoint);
}
