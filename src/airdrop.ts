import { Balance, Transaction, TransactionPayload } from "@elrondnetwork/erdjs";
import { NetworkConfig } from "@elrondnetwork/erdjs-network-providers";
import { AccountWatcher } from "./erdjsPatching/accountWatcher";
import { ESDTTransferPayloadBuilder } from "./erdjsPatching/transactionBuilders";
import { ErrNotImplemented } from "./errors";
import { computeGasLimit } from "./gasLimit";
import { ITestSession, ITestUser } from "./interface";
import { INetworkProvider } from "./interfaceOfNetwork";

export function createAirdropService(session: ITestSession): AirdropService {
    let networkProvider = session.networkProvider;
    let networkConfig = session.getNetworkConfig();
    let service = new AirdropService(networkProvider, networkConfig);
    return service;
}

export class AirdropService {
    private readonly networkProvider: INetworkProvider;
    private readonly networkConfig: NetworkConfig;

    constructor(networkProvider: INetworkProvider, networkConfig: NetworkConfig) {
        this.networkProvider = networkProvider;
        this.networkConfig = networkConfig;
    }

    async sendToEachUser(sender: ITestUser, receivers: ITestUser[], amount: Balance) {
        let transactions = this.createTransactions(sender, receivers, amount);

        let promisesOfSignAndSend = transactions.map(async (transaction) => {
            await sender.signer.sign(transaction);
            await this.networkProvider.sendTransaction(transaction);
        });

        await Promise.all(promisesOfSignAndSend);

        let senderExpectedNonce = sender.account.nonce;
        let watcher = new AccountWatcher(sender.address, this.networkProvider);
        await watcher.awaitNonce(senderExpectedNonce);
    }

    private createTransactions(sender: ITestUser, receivers: ITestUser[], amount: Balance): Transaction[] {
        let transactions: Transaction[] = [];
        // Temporary workaround:
        let isFungible = amount.getNonce().toNumber() == 0;

        for (const receiver of receivers) {
            if (sender.address.bech32() == receiver.address.bech32()) {
                continue;
            }

            let value = Balance.Zero();
            let data = new TransactionPayload();
            let gasLimit = computeGasLimit(this.networkConfig);

            if (amount.token.isEgld()) {
                value = amount;
            } else if (isFungible) {
                data = new ESDTTransferPayloadBuilder().setAmount(amount).build();
                gasLimit = computeGasLimit(this.networkConfig, data.length(), 300000);
            } else {
                throw new ErrNotImplemented("transfer of other tokens");
            }

            transactions.push(new Transaction({
                nonce: sender.account.getNonceThenIncrement(),
                receiver: receiver.address,
                value: value,
                data: data,
                gasLimit: gasLimit,
                chainID: this.networkConfig.ChainID
            }));
        }

        return transactions;
    }
}
