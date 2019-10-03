/*
 * Copyright (c) 2016-present,
 * Jaguar0625, gimre, BloodyRookie, Tech Bureau, Corp. All rights reserved.
 *
 * This file is part of Catapult.
 *
 * Catapult is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Catapult is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Catapult.  If not, see <http://www.gnu.org/licenses/>.
 */

const routeResultTypes = require('./routeResultTypes');
const routeUtils = require('./routeUtils');
const catapult = require('catapult-sdk');

const { convert } = catapult.utils;
const { PacketType } = catapult.packet;

const constants = {
	sizes: {
		hash: 64,
		objectId: 24
	}
};

const getLimit = (validLimits, params) => {
	const limit = routeUtils.parseArgument(params, 'limit', 'uint');
	return -1 === validLimits.indexOf(limit) ? undefined : limit;
};

// Parse object ID from string.
const parseObjectId = str => {
	if (!convert.isHexString(str))
		throw Error('must be 12-byte hex string');

	return str;
};

// Parse hash from string.
const parseHash = str => convert.hexToUint8(str);

// Implied method to get transactions from or since identifier.
//	req - Request data.
// 	res - Response data.
//	next - Control flow callback.
// 	pageSizes - Array of valid page sizes.
// 	redirectUrl - Callback to get redirect URL.
//  direction - 'From' or 'Since'.
//  transformer - Callback to transform each element.
//  resultType - Data result type (for formatting).
const getTransactions = (req, res, next, db, pageSizes, redirectUrl, direction, transformer, resultType) => {
	const transaction = req.params.transaction;
	const limit = getLimit(pageSizes, req.params);
	const collectionName = 'transactions';

	if (!limit) {
		return res.redirect(redirectUrl(transaction, pageSizes[0]), next);
	}

	if ('earliest' === transaction) {
		db['transactions' + direction + 'Earliest'](collectionName, limit).then(transactions => {
			const data = transactions.map(transformer);
			res.send({ payload: data, type: resultType });
			next();
		});
	} else if ('latest' === transaction) {
		db['transactions' + direction + 'Latest'](collectionName, limit).then(transactions => {
			const data = transactions.map(transformer);
			res.send({ payload: data, type: resultType });
			next();
		});
	} else if (constants.sizes.objectId === transaction.length) {
		const id = parseObjectId(transaction);
		db['transactions' + direction + 'Id'](collectionName, id, limit).then(transactions => {
			const data = transactions.map(transformer);
			res.send({ payload: data, type: resultType });
			next();
		});
	} else if (constants.sizes.hash === transaction.length) {
		const hash = parseHash(transaction);
		db['transactions' + direction + 'Hash'](collectionName, hash, limit).then(transactions => {
			const data = transactions.map(transformer);
			res.send({ payload: data, type: resultType });
			next();
		});
	} else {
		throw new Error(`invalid length of transaction id '${transaction}'`)
	}
}

module.exports = {
	register: (server, db, services) => {
		const validPageSizes = routeUtils.generateValidPageSizes(services.config.pageSize); // throws if there is not at least one valid page size
		const sender = routeUtils.createSender(routeResultTypes.transaction);

		routeUtils.addPutPacketRoute(
			server,
			services.connections,
			{ routeName: '/transaction', packetType: PacketType.pushTransactions },
			params => routeUtils.parseArgument(params, 'payload', convert.hexToUint8)
		);

		routeUtils.addGetPostDocumentRoutes(
			server,
			sender,
			{ base: '/transaction', singular: 'transactionId', plural: 'transactionIds' },
			// params has already been converted by a parser below, so it is: string - in case of objectId, Uint8Array - in case of hash
			params => (('string' === typeof params[0]) ? db.transactionsByIds(params) : db.transactionsByHashes(params)),
			(transactionId, index, array) => {
				if (0 < index && array[0].length !== transactionId.length)
					throw Error(`all ids must be homogeneous, element ${index}`);

				if (constants.sizes.objectId === transactionId.length)
					return parseObjectId(transactionId);
				if (constants.sizes.hash === transactionId.length)
					return convert.hexToUint8(transactionId);

				throw Error(`invalid length of transaction id '${transactionId}'`);
			}
		);

		// CURSORS

		// Gets transaction up to the identifier (non-inclusive).
		// The identifier may be:
		//	- latest (returning up-to and including the latest transaction).
		//	- earliest (returning from the earliest transaction, IE, nothing).
		//	- A transaction hash.
		//	- A transaction ID.
		server.get('/transactions/from/:transaction/limit/:limit', (req, res, next) => {
			const redirectUrl = (transaction, pageSize) => `/transactions/from/${transaction}/limit/${pageSize}`;
			const direction = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});

		// Gets transaction since the identifier (non-inclusive).
		// The identifier may be:
		//	- latest (returning since the latest transaction, IE, nothing).
		//	- earliest (returning since the earliest transaction).
		//	- A transaction hash.
		//	- A transaction ID.
		server.get('/transactions/since/:transaction/limit/:limit', (req, res, next) => {
			const redirectUrl = (transaction, pageSize) => `/transactions/since/${transaction}/limit/${pageSize}`;
			const direction = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/from/:transaction/limit/:limit/hash', (req, res, next) => {
			const redirectUrl = (transaction, pageSize) => `/transactions/from/${transaction}/limit/${pageSize}/hash`;
			const direction = 'From';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/since/:transaction/limit/:limit/hash', (req, res, next) => {
			const redirectUrl = (transaction, pageSize) => `/transactions/since/${transaction}/limit/${pageSize}/hash`;
			const direction = 'Since';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});
	}
};
