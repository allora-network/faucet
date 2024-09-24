import { stringToPath } from '@cosmjs/crypto'
import fs from 'fs'
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const mnemonic_path= "config/secret/mnemonic"
let mnemonics;
try {
    mnemonics = fs.readFileSync(mnemonic_path, 'utf8').trim().split('\n');
    if (mnemonics.length === 0) throw new Error("Mnemonic file is empty");
} catch (err) {
    console.error(`Error reading mnemonics from ${mnemonic_path}:`, err);
    process.exit(1);
}

console.log("==================================================================");
if (mnemonics[0].length >= 15) {
    console.log(`faucet mnemonic: ${mnemonics[0].substring(1, 15)} ...`);
} else {
    console.log(`faucet mnemonic: ${mnemonics[0]} ...`);
}

export default {

    "port": 8000,  // http port
    "db": {
        "path": `./faucet.db` // db for frequency checker(WIP)
    },
    "project": {
        "name": "Allora Testnet", // What ever you want, recommend: chain-id, 
        "logo": "https://s3.amazonaws.com/assets.allora.network/logo.svg",
        "deployer": '<a href="https://allora.network">Allora</a>'
    },
    blockchains: [
    {
        name: "allora-testnet-1",
        endpoint: {
            // make sure that CORS is enabled in rpc section in config.toml
            // cors_allowed_origins = ["*"]
            rpc_endpoint: "https://allora-rpc.testnet-1.testnet.allora.network/",
        },
        sender: {
            mnemonics,
            option: {
                hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
                prefix: "allo" // human readable address prefix
            }
        },
        tx: {
            amount: [
            { denom: "uallo", amount: "1000000000" },
            ],
            fee: {
                amount: [{ denom: "uallo", amount: "500" }],
                gas: "200000",
            },
        },
        limit: {
            // how many times each wallet address is allowed in a window(24h)
            address: 2,
            // how many times each ip is allowed in a window(24h),
            // if you use proxy, double check if the req.ip is return client's ip.
            ip: 20,
            cooldownInSec: 1,
            processableAddresses: 100
        }
    },
    ],
    reCaptcha: {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        secretKey: process.env.RECAPTCHA_SECRET_KEY
    }
}
