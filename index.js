import { TonClient, WalletContractV4, internal, WalletContractV3R2, toNano, SendMode, Address, JettonWallet } from "@ton/ton";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { createBackoff } from 'teslabot';
import TonWeb from "tonweb";
// import DataLoader from "dataloader";
// import { Address, TonTransaction } from "ton";


export const backoff = createBackoff({ onError: (e, f) => f > 3 && console.warn(e) });
const client = new TonClient({
    endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC?api_key=',
});

export const getTonSendMode = (max) => {
    return max === "1"
        ? SendMode.CARRY_ALL_REMAINING_BALANCE
        : SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;
};


const seeIfBounceable = (address) => {
    return Address.isFriendly(address)
        ? Address.parseFriendly(address).isBounceable
        : false;
};


export async function fetchBlock(seqno) {

    // Initial method
    if (seqno <= 1) {
        return [{
            workchain: -1,
            seqno,
            shard: '-9223372036854775808',
            transactions: []
        }];
    }

    // Fetch shards
    let [currentShardDefs, prevShardDefs] = await Promise.all([
        backoff(() => client.getWorkchainShards(seqno)),
        backoff(() => client.getWorkchainShards(seqno - 1))
    ]);
    // Resolve all intermediate shards
    let shardDefs = [{ workchain: -1, seqno, shard: '-9223372036854775808' }];
    for (let sh of currentShardDefs) {
        let prev = prevShardDefs.find((v) => v.shard === sh.shard && v.workchain === sh.workchain);
        if (prev) {
            for (let i = prev.seqno + 1; i <= sh.seqno; i++) {
                shardDefs.push({ workchain: sh.workchain, shard: sh.shard, seqno: i });
            }
        } else {
            shardDefs.push({ workchain: sh.workchain, shard: sh.shard, seqno: sh.seqno });
        }
    }

    // Fetch shard transactions
    let shards = await Promise.all(shardDefs.map(async (def) => {
        let tx = await backoff(() => client.getShardTransactions(def.workchain, def.seqno, def.shard));
        let transactions = tx.map((v) => ({ address: v.account, lt: v.lt, hash: v.hash }));
        return {
            workchain: def.workchain,
            seqno: def.seqno,
            shard: def.shard,
            transactions
        };
    }));
    return shards;
}
export async function applyBlocks(blocks) {
    await blocksCollection.bulkWrite(blocks.map((v) => ({
        updateOne: {
            filter: { _id: v.seq },
            update: { $set: { data: v.data } },
            upsert: true
        }
    })));
}


(async () => {
    // Convert mnemonics to private key
    let mnemonics = "".split(" ");
    let keyPair = await mnemonicToPrivateKey(mnemonics);

    // Create wallet contract
    let workchain = 0; // Usually you need a workchain 0
    let wallet = WalletContractV4.create({ workchain, publicKey: keyPair.publicKey });
    let contract = client.open(wallet);

    // Create a transfer
    let seqno = await contract.getSeqno();
    console.log("🚀 ~ seqno:", seqno);

    const transfer = contract.createTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: getTonSendMode("0"),
        messages: [
            internal({
                to: "UQCunQgU9UX1mVHEuKT-V6MTFTAoLel2u4HEMOaaKQ5ZzpTd",
                bounce: seeIfBounceable("UQCunQgU9UX1mVHEuKT-V6MTFTAoLel2u4HEMOaaKQ5ZzpTd"),
                value: toNano(0.22),
                init: undefined,
                body: "hello",
            }),
        ],
    });
    // const data = await client.estimateExternalMessageFee(Address.parse("0QAfXKrddeHxwTRjP_MpBmy8u0k2ThwyclIsHVNL6lqcc5gp"),{
    //     body: transfer,
    //     initCode: null,
    //     initData: null,
    //     ignoreSignature: true,
    // })

    let tx_last = "";
    console.log(new Date().getTime());
    contract.send(transfer);
    while (true) {
        let transactions = await client.getTransactions(wallet.address, {
            inclusive: true
        });
        console.log("🚀 ~ transactions:", transactions[0].hash().toString("base64"));
        if(tx_last != "" && tx_last != transactions[0].hash().toString("base64")){
            tx_last = transactions[0].hash().toString("base64");
            break;
        }
        tx_last = transactions[0].hash().toString("base64");
        
        await wait(5000);
    }

    console.log("🚀 ~ tx_last:", tx_last);
    await wait(2000);

    await fetchDataTransaction(tx_last);
})();

function wait(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}

async function fetchDataTransaction(hash){
    try{
        const result = await fetch(`https://testnet.tonapi.io/v2/traces/${hash}`);
        const data_traces=  await result.json();


        //

        const result_event = await fetch(`https://testnet.tonapi.io/v2/events/${data_traces?.transaction?.hash}`);
        const data_event = await result_event.json();
        console.log("🚀 ~ fetchDataTransaction ~ data_event:", data_event)
        console.log("🚀 ~ fetchDataTransaction ~ data_event:", data_event.actions)
        console.log("🚀 ~ fetchDataTransaction ~ data_event:", data_event.timestamp)


        
    }catch(err){
        console.log("🚀 ~ fetchDataTransaction ~ err:", err)
    }
}