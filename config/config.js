import { stringToPath } from '@cosmjs/crypto'
import fs from 'fs'
import { Wallet, utils } from 'ethers';

// const mnemonic_path= './secret/{{.rootValues.alloraAccountSecretName}}'
const mnemonic = "window ..."
console.log("==================================================================")
console.log(`faucet mnemonic: ${mnemonic.substring(0, 15)} ...`)

export default {

  "port": 8000,  // http port
  "db": {
      "path": `./faucet.db` // db for frequency checker(WIP)
  },
  "project": {
      "name": "Allora testnet-1",
      "logo": "https://s3.amazonaws.com/assets.allora.network/logo.svg",
      "deployer": '<a href="https://allora.network">Allora</a>'
  },
  blockchains: [
    {
      name: "allora-testnet-1",
      endpoint: {
          // make sure that CORS is enabled in rpc section in config.toml
          // cors_allowed_origins = ["*"]
          rpc_endpoint: "https://allora-rpc.testnet-1.testnet.allora.network",
      },
      sender: {
          mnemonic,
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
              amount: [{ denom: "uallo", amount: "1000" }],
              gas: "200000",
          },
      },
      limit: {
          // how many times each wallet address is allowed in a window(24h)
          address: 2,
          // how many times each ip is allowed in a window(24h),
          // if you use proxy, double check if the req.ip is return client's ip.
          ip: 20
      }
    },
  ]
}