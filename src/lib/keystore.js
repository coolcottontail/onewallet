import pbkdf2 from 'pbkdf2'
import aesjs from 'aes-js'
import store from '../popup/store'
import { encryptPhrase, getAddress, decryptPhrase } from '@harmony-js/crypto'
const { ChainID, ChainType, isValidAddress, Unit } = require('@harmony-js/utils');
import { Harmony } from '@harmony-js/core';

var currentNetwork = ""
var harmony = new Harmony(
    // rpc url
    store.state.network.apiUrl,
    {
        chainType: store.state.network.type,  //ChainType.Harmony,
        chainId: store.state.network.chainId,   //ChainID.HmyMainnet,
    },
);

const uuidv4 = require('uuid/v4')

/* Convert a byte to string */
function byte2hexStr(byte) {
    var hexByteMap = "0123456789ABCDEF";
    var str = "";
    str += hexByteMap.charAt(byte >> 4);
    str += hexByteMap.charAt(byte & 0x0f);
    return str;
}

function byteArray2hexStr(byteArray) {
    let str = "";
    for (let i = 0; i < (byteArray.length); i++) {
        str += byte2hexStr(byteArray[i]);
    }
    return str;
}

function stringToBytes(str) {
    var bytes = new Array();
    var len, c;
    len = str.length;
    for (var i = 0; i < len; i++) {
        c = str.charCodeAt(i);
        if (c >= 0x010000 && c <= 0x10FFFF) {
            bytes.push(((c >> 18) & 0x07) | 0xF0);
            bytes.push(((c >> 12) & 0x3F) | 0x80);
            bytes.push(((c >> 6) & 0x3F) | 0x80);
            bytes.push((c & 0x3F) | 0x80);
        } else if (c >= 0x000800 && c <= 0x00FFFF) {
            bytes.push(((c >> 12) & 0x0F) | 0xE0);
            bytes.push(((c >> 6) & 0x3F) | 0x80);
            bytes.push((c & 0x3F) | 0x80);
        } else if (c >= 0x000080 && c <= 0x0007FF) {
            bytes.push(((c >> 6) & 0x1F) | 0xC0);
            bytes.push((c & 0x3F) | 0x80);
        } else {
            bytes.push(c & 0xFF);
        }
    }
    return bytes;

}

export default function getHarmony() {
    if (currentNetwork != store.state.network.name) {
        currentNetwork = store.state.network.name
        console.log("current network changed to", currentNetwork)
        harmony = new Harmony(
            // rpc url
            store.state.network.apiUrl,
            {
                chainType: store.state.network.type,  //ChainType.Harmony,
                chainId: store.state.network.chainId,   //ChainID.HmyMainnet,
            },
        );
    }

    return harmony
}

export function encryptKey(password, salt) {
    return pbkdf2.pbkdf2Sync(password, salt, 1, 256 / 8, 'sha512')
}

export function encryptString(password, hexString) {
    const textBytes = aesjs.utils.utf8.toBytes(hexString)
    const aesCtr = new aesjs.ModeOfOperation.ctr(password)
    const encrypted = aesCtr.encrypt(textBytes)

    return {
        bytes: encrypted,
        hex: aesjs.utils.hex.fromBytes(encrypted),
    }
}

export function decryptString(password, salt, hexString) {
    const key = encryptKey(password, salt)
    const encryptedBytes = aesjs.utils.hex.toBytes(hexString)
    const aesCtr = new aesjs.ModeOfOperation.ctr(key)
    const decryptedBytes = aesCtr.decrypt(encryptedBytes)

    return aesjs.utils.utf8.fromBytes(decryptedBytes)
}

export function validatePrivateKey(privateKey) {
    try {
        const address = pkToAddress(privateKey)
        return isAddressValid(address)
    } catch (e) {
        return false
    }
}

export function encryptKeyStore(password, privateKey, address) {
    const salt = uuidv4()
    const encryptedKey = encryptKey(password, salt)
    const { hex } = encryptString(encryptedKey, privateKey)

    const data = {
        version: 1,
        key: hex,
        address: address,
        salt,
    }

    return byteArray2hexStr(stringToBytes(JSON.stringify(data)))
}

export function decryptKeyStore(password, keystore) {
    if (!password) {
        return false
    }

    const { key, address, salt } = JSON.parse(bytesToString(hexStr2byteArray(keystore)))

    console.log("password =", password)
    console.log("key =", key)
    console.log("address = ", address)
    console.log("salt = ", salt)

    const privateKey = decryptString(password, salt, key)

    console.log("privte key = ", privateKey)

    const oneAddress = importPriveKey(privateKey)
    console.log("decrypted address = ", oneAddress)

    if (isValidAddress(oneAddress) && oneAddress === address) {
        return {
            address,
            privateKey
        }
    }

    return false
}

export function createAccount( name, password ) {
    let seed = getHarmony().wallet.newMnemonic()
    const keyStore = encryptPhrase(seed, password)
    const account = getHarmony().wallet.addByMnemonic(seed)

    const newAccount = {
        name,
        recoverByCode: true,
        keyStore,
        address: getAddress(account.address).bech32
    }

    // const existedAccounts = await getAccounts()
    // await saveValue({ accounts: [...existedAccounts, newAccount] })
    //return newAccount

    let address = getAddress(account.address).bech32
    let privateKey = account.privateKey
    let passwd = password

    return {
        privateKey,
        address,
        passwd,
    }
}

export function importPriveKey( privateKey ) {
    let account = getHarmony().wallet.addByPrivateKey(privateKey)
    let address = getAddress(account.address).bech32
    return address
}


// 0x1b4dc81bc7245c648e846c0d6f4d818425733a988aafa7030001b409bc71f27c
// one1jcq8d7afnsz4kj8yjt39wnljvj8qkx5ccydgd6
export async  function getBalance(address, shardId ) {
    getHarmony().blockchain.messenger.setDefaultShardID(shardId);
    let ret = await getHarmony().blockchain.getBalance( {address})

    return ret.result
}

export async  function getShardInfo() {
    //set sharding
    const res = await harmony.blockchain.getShardingStructure();
    getHarmony().shardingStructures(res.result);

    return res.result
}

export function checkAddress(address) {
    return isValidAddress(address)
}

export async function transferToken(from, to, fromShard, toShard, amount, privateKey, gasLimit = "21000", gasPrice = 1 ) {
    let harmony = getHarmony()
    let account = harmony.wallet.addByPrivateKey(privateKey)
    let explorerLink = 'https://explorer.testnet.harmony.one/#/tx/'

    let transactionObj = {
        from: from,
        to: to,
        shardID: '0x'+fromShard.toString(16),
        toShardID: '0x'+toShard.toString(16),
        value: new Unit(amount).asEther().toWei().toString(),
        gasLimit: new Unit(gasLimit).asWei().toWei().toString(),
        gasPrice: new Unit(gasPrice).asWei().toWei().toString(),
        chainId: store.state.network.chainId,
    };

    let txn = harmony.transactions.newTx(transactionObj, true);
    let message = ""
    let status = true

    await setSharding();
    harmony.blockchain.messenger.setDefaultShardID(fromShard)
    account.signTransaction(txn, true)
            .then(signed => {
            signed
                .sendTransaction()
                .then(res => {
                    let [transaction, hash] = res;
                    let url = explorerLink + hash;
                    console.log(url)
                    transaction.confirm(hash).then(res => {
                        console.log(res);
                        if (res.txStatus == "CONFIRMED") {
                            // this.balanceUpdate();
                           console.log("trasnsaction_succeed");
                           status  = true;
                           message = url;
                        }
                    });
                })
                .catch(err => {
                    console.log(err);
                    console.log("transfer_fail");
                    this.transferring = false;
                    message = err.toString();
                    status  = false;
                });
        })
            .catch(err => {
                console.log(err);
                console.log("transfer_fail");
                this.transferring = false;
                message = err.toString();
                status  = false;
         });

    return {
        result: status,
        mesg: message,
    }
}

export async function  getTransfers( address,  pageIndex, pageSize, order = 'DESC') {
    let harmony = getHarmony()
    const ret = await harmony.messenger.send(
        'hmy_getTransactionsHistory',
        [{
            "address": address,
            "pageIndex": pageIndex,
            "pageSize": pageSize,
            "fullTx": true,
            "txType": "ALL",
            "order": "DESC"
        }],
        harmony.messenger.chainPrefix,
        harmony.messenger.getCurrentShardID(),
    );

    return ret.result;
}

export async function  getTransactionCount( addr) {
    let harmony = getHarmony()

    // const ret = await harmony.blockchain.getTransactionCount( {address: 'one1zksj3evekayy90xt4psrz8h6j2v3hla4qwz4ur'})
    const ret = await harmony.blockchain.getTransactionCount( {address: addr})

    return parseInt(ret.result);
}


export function  getNetworkLink(path) {
    var basic
    switch (currentNetwork) {
        case "Mainnet": {
            basic = "https://explorer.harmony.one/#";
            break;
        }
        case "Pangaea": {
            basic = "https://explorer.pangaea.harmony.one/#";
            break;
        }
        case "Testnet": {
            basic = "https://explorer.testnet.harmony.one/#";
            break;
        }
        case "OpensSakingNet": {
            basic = "https://explorer.os.harmony.one/#";
            break;
        }
        case "Localnet": {
            basic = "";
            break;
        }
        default: {
            basic = "https://explorer.harmony.one/#";
            break;
        }
    }

    return basic + path
}
