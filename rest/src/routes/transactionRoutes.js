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

// Implied method to get transactions from or since identifier.
//	req - Request data.
// 	res - Response data.
//	next - Control flow callback.
//	db - Database utility.
//	collectionName - Name of the collection to query.
// 	countRange - Range of valid query counts.
// 	redirectUrl - Callback to get redirect URL.
//  duration - 'From' or 'Since'.
//  transformer - Callback to transform each element.
//  resultType - Data result type (for formatting).
const getTransactions = (req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType) => {
	const transaction = req.params.transaction;
	const limit = routeUtils.parseRangeArgument(req.params, 'limit', countRange, 'uint');

	if (!limit) {
		return res.redirect(redirectUrl(transaction, countRange.preset), next);
	}

	let dbMethod;
	let dbArgs;
	if (routeUtils.validateValue(transaction, 'earliest')) {
		dbMethod = 'transactions' + duration + 'Earliest';
		dbArgs = [collectionName, limit];
	} else if (routeUtils.validateValue(transaction, 'latest')) {
		dbMethod = 'transactions' + duration + 'Latest';
		dbArgs = [collectionName, limit];
	} else if (routeUtils.validateValue(transaction, 'objectId')) {
		const id = routeUtils.parseValue(transaction, 'objectId');
		dbMethod = 'transactions' + duration + 'Id';
		dbArgs = [collectionName, id, limit];
	} else if (routeUtils.validateValue(transaction, 'hash256')) {
		const hash = routeUtils.parseValue(transaction, 'hash256');
		dbMethod = 'transactions' + duration + 'Hash';
		dbArgs = [collectionName, hash, limit];
	} else {
		throw new Error(`invalid transaction identifier '${transaction}'`)
	}

	routeUtils.queryAndSendDurationCollection(res, next, db, dbMethod, dbArgs, transformer, resultType);
}

// TODO(ahuszagh) Need a way to get transactions by type.

module.exports = {
	register: (server, db, services) => {
		const countRange = services.config.countRange;
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

				if (routeUtils.validateValue(transactionId, 'objectId'))
					return routeUtils.parseValue(transactionId, 'objectId');
				if (routeUtils.validateValue(transactionId, 'hash256'))
					return routeUtils.parseValue(transactionId, 'hash256');

				throw Error(`invalid length of transaction id '${transactionId}'`);
			}
		);

		// CURSORS - CONFIRMED TRANSACTIONS

		// Gets transactions up to the identifier (non-inclusive).
		// The identifier may be:
		//	- latest (returning up-to and including the latest transaction).
		//	- earliest (returning from the earliest transaction, IE, nothing).
		//	- A transaction hash.
		//	- A transaction ID.
		server.get('/transactions/from/:transaction/limit/:limit', (req, res, next) => {
			const collectionName = 'transactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/from/${transaction}/limit/${pageSize}`;
			const duration = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// Gets transactions since the identifier (non-inclusive).
		// The identifier may be:
		//	- latest (returning since the latest transaction, IE, nothing).
		//	- earliest (returning since the earliest transaction).
		//	- A transaction hash.
		//	- A transaction ID.
		server.get('/transactions/since/:transaction/limit/:limit', (req, res, next) => {
			const collectionName = 'transactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/since/${transaction}/limit/${pageSize}`;
			const duration = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/from/:transaction/limit/:limit/hash', (req, res, next) => {
			const collectionName = 'transactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/from/${transaction}/limit/${pageSize}/hash`;
			const duration = 'From';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/since/:transaction/limit/:limit/hash', (req, res, next) => {
			const collectionName = 'transactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/since/${transaction}/limit/${pageSize}/hash`;
			const duration = 'Since';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// CURSORS -- CONFIRMED TRANSACTIONS BY TYPE

		// TODO(ahuszagh) Need to implement...

		// CURSORS -- UNCONFIRMED TRANSACTIONS

		// Gets unconfirmed transactions up to the identifier (non-inclusive).
		// The identifier may be:
		//  - latest (returning up-to and including the latest transaction).
		//  - earliest (returning from the earliest transaction, IE, nothing).
		//  - A transaction hash.
		//  - A transaction ID.
		server.get('/transactions/unconfirmed/from/:transaction/limit/:limit', (req, res, next) => {
			const collectionName = 'unconfirmedTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/unconfirmed/from/${transaction}/limit/${pageSize}`;
			const duration = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// Gets unconfirmed transactions since the identifier (non-inclusive).
		// The identifier may be:
		//  - latest (returning since the latest transaction, IE, nothing).
		//  - earliest (returning since the earliest transaction).
		//  - A transaction hash.
		//  - A transaction ID.
		server.get('/transactions/unconfirmed/since/:transaction/limit/:limit', (req, res, next) => {
			const collectionName = 'unconfirmedTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/unconfirmed/since/${transaction}/limit/${pageSize}`;
			const duration = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/unconfirmed/from/:transaction/limit/:limit/hash', (req, res, next) => {
			const collectionName = 'unconfirmedTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/unconfirmed/from/${transaction}/limit/${pageSize}/hash`;
			const duration = 'From';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/unconfirmed/since/:transaction/limit/:limit/hash', (req, res, next) => {
			const collectionName = 'unconfirmedTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/unconfirmed/since/${transaction}/limit/${pageSize}/hash`;
			const duration = 'Since';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// CURSORS -- PARTIAL TRANSACTIONS

		// Gets partial transactions up to the identifier (non-inclusive).
		// The identifier may be:
		//  - latest (returning up-to and including the latest transaction).
		//  - earliest (returning from the earliest transaction, IE, nothing).
		//  - A transaction hash.
		//  - A transaction ID.
		server.get('/transactions/partial/from/:transaction/limit/:limit', (req, res, next) => {
			const collectionName = 'partialTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/partial/from/${transaction}/limit/${pageSize}`;
			const duration = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// Gets partial transactions since the identifier (non-inclusive).
		// The identifier may be:
		//  - latest (returning since the latest transaction, IE, nothing).
		//  - earliest (returning since the earliest transaction).
		//  - A transaction hash.
		//  - A transaction ID.
		server.get('/transactions/partial/since/:transaction/limit/:limit', (req, res, next) => {
			const collectionName = 'partialTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/partial/since/${transaction}/limit/${pageSize}`;
			const duration = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.transaction;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/partial/from/:transaction/limit/:limit/hash', (req, res, next) => {
			const collectionName = 'partialTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/partial/from/${transaction}/limit/${pageSize}/hash`;
			const duration = 'From';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/transactions/partial/since/:transaction/limit/:limit/hash', (req, res, next) => {
			const collectionName = 'partialTransactions';
			const redirectUrl = (transaction, pageSize) => `/transactions/partial/since/${transaction}/limit/${pageSize}/hash`;
			const duration = 'Since';
			const transformer = (info) => { return { hash: info.meta.hash }; };
			const resultType = routeResultTypes.transactionHash;
			return getTransactions(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});
	}
};
