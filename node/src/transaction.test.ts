/*
 * Copyright 2020 IBM All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import Long from 'long';
import { MockGatewayClient, newMockGatewayClient } from './client.test';
import { Contract } from './contract';
import { Gateway, internalConnect, InternalConnectOptions } from './gateway';
import { Identity } from './identity/identity';
import { Network } from './network';
import { protos } from './protos/protos';

describe('Transaction', () => {
    const expectedResult = 'TX_RESULT';

    let client: MockGatewayClient;
    let identity: Identity;
    let signer: jest.Mock<Promise<Uint8Array>, Uint8Array[]>;
    let hash: jest.Mock<Uint8Array, Uint8Array[]>;
    let gateway: Gateway;
    let network: Network;
    let contract: Contract;

    beforeEach(() => {
        client = newMockGatewayClient();
        client.endorse.mockResolvedValue({
            prepared_transaction: {
                payload: Buffer.from('PAYLOAD'),
            },
            result: {
                payload: Buffer.from(expectedResult),
            },
        });
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.VALID,
        });

        identity = {
            mspId: 'MSP_ID',
            credentials: Buffer.from('CERTIFICATE'),
        }
        signer = jest.fn(undefined);
        signer.mockResolvedValue(Buffer.from('SIGNATURE'));
        hash = jest.fn(undefined);
        hash.mockReturnValue(Buffer.from('DIGEST'));

        const options: InternalConnectOptions = {
            identity,
            signer,
            hash,
            gatewayClient: client,
        };
        gateway = internalConnect(options);
        network = gateway.getNetwork('CHANNEL_NAME');
        contract = network.getContract('CHAINCODE_ID');
    });

    it('throws on submit error', async () => {
        client.submit.mockRejectedValue(new Error('ERROR_MESSAGE'));

        await expect(contract.submitTransaction('TRANSACTION_NAME')).rejects.toThrow('ERROR_MESSAGE');
    });

    it('throws on commit failure', async () => {
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.MVCC_READ_CONFLICT,
        });

        await expect(contract.submitTransaction('TRANSACTION_NAME'))
            .rejects.toThrow(protos.TxValidationCode[protos.TxValidationCode.MVCC_READ_CONFLICT]);
    });

    it('returns result', async () => {
        const result = await contract.submitTransaction('TRANSACTION_NAME');

        const actual = Buffer.from(result).toString();
        expect(actual).toBe(expectedResult);
    });

    it('sets endorsing orgs', async () => {
        await contract.submit('TRANSACTION_NAME', { endorsingOrganizations: ['org1', 'org3']});
        const actualOrgs = client.endorse.mock.calls[0][0].endorsing_organizations;
        expect(actualOrgs).toStrictEqual(['org1', 'org3']);
    });

    it('uses signer for submit', async () => {
        signer.mockResolvedValue(Buffer.from('MY_SIGNATURE'));

        await contract.submitTransaction('TRANSACTION_NAME');

        const submitRequest = client.submit.mock.calls[0][0];
        const signature = Buffer.from(submitRequest.prepared_transaction?.signature ?? '').toString();
        expect(signature).toBe('MY_SIGNATURE');
    });

    it('uses signer for commit', async () => {
        signer.mockResolvedValue(Buffer.from('MY_SIGNATURE'));

        await contract.submitTransaction('TRANSACTION_NAME');

        const statusRequest = client.commitStatus.mock.calls[0][0];
        const signature = Buffer.from(statusRequest.signature ?? '').toString();
        expect(signature).toBe('MY_SIGNATURE');
    });

    it('uses hash', async () => {
        hash.mockReturnValue(Buffer.from('MY_DIGEST'));

        await contract.submitTransaction('TRANSACTION_NAME');

        expect(signer).toHaveBeenCalledTimes(3); // endorse, submit and commit
        signer.mock.calls.forEach(call => {
            const digest = call[0].toString();
            expect(digest).toBe('MY_DIGEST');
        });
    });

    it('commit returns transaction validation code', async () => {
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.MVCC_READ_CONFLICT,
        });

        const commit = await contract.submitAsync('TRANSACTION_NAME');
        const status = await commit.getStatus();

        expect(status).toBe(protos.TxValidationCode.MVCC_READ_CONFLICT);
    });

    it('commit returns successful for successful transaction', async () => {
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.VALID,
        });

        const commit = await contract.submitAsync('TRANSACTION_NAME');
        const success = await commit.isSuccessful();

        expect(success).toBe(true);
    });

    it('commit returns unsuccessful for failed transaction', async () => {
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.MVCC_READ_CONFLICT,
        });

        const commit = await contract.submitAsync('TRANSACTION_NAME');
        const success = await commit.isSuccessful();

        expect(success).toBe(false);
    });

    it('commit returns Long block number', async () => {
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.MVCC_READ_CONFLICT,
            block_number: Long.fromInt(101, true),
        });

        const commit = await contract.submitAsync('TRANSACTION_NAME');
        const blockNumber = await commit.getBlockNumber();

        expect(blockNumber).toEqual(Long.fromInt(101, true));
    });

    it('commit returns number block number', async () => {
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.MVCC_READ_CONFLICT,
            block_number: 101,
        });

        const commit = await contract.submitAsync('TRANSACTION_NAME');
        const blockNumber = await commit.getBlockNumber();

        expect(blockNumber).toEqual(Long.fromInt(101, true));
    });

    it('commit throws accessing missing block number', async () => {
        client.commitStatus.mockResolvedValue({
            result: protos.TxValidationCode.MVCC_READ_CONFLICT,
        });

        const commit = await contract.submitAsync('TRANSACTION_NAME');
        await expect(() => commit.getBlockNumber())
            .rejects
            .toThrow();
    });
});
