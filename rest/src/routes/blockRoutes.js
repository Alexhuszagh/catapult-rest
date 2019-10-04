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

const dbFacade = require('./dbFacade');
const dbUtils = require('../db/dbUtils');
const routeResultTypes = require('./routeResultTypes');
const routeUtils = require('./routeUtils');
const errors = require('../server/errors');

const alignDown = (height, alignment) => (Math.floor((height - 1) / alignment) * alignment) + 1;

// Implied method to get blocks from or since height.
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
const getBlocks = (req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType) => {
	const height = routeUtils.parseArgument(req.params, 'height', 'uintOrTime');
	const limit = routeUtils.parseRangeArgument(req.params, 'limit', countRange, 'uint');

	if (!limit) {
		return res.redirect(redirectUrl(req.params.height, countRange.preset), next);
	}

	const dbMethod = 'blocks' + duration + 'Height';
	const dbArgs = [collectionName, height, limit];
	routeUtils.queryAndSendDurationCollection(res, next, height, db, dbMethod, dbArgs, transformer, resultType);
};

module.exports = {
	register: (server, db, { config }) => {
		const validPageSizes = routeUtils.generateValidPageSizes(config.pageSize);
		const countRange = config.countRange;

		server.get('/block/:height', (req, res, next) => {
			const height = routeUtils.parseArgument(req.params, 'height', 'uint');

			return dbFacade.runHeightDependentOperation(db, height, () => db.blockAtHeight(height))
				.then(result => result.payload)
				.then(routeUtils.createSender(routeResultTypes.block).sendOne(height, res, next));
		});

		server.get(
			'/block/:height/transaction/:hash/merkle',
			routeUtils.blockRouteMerkleProcessor(db, 'numTransactions', 'transactionMerkleTree')
		);

		server.get('/block/:height/transactions', (req, res, next) => {
			const height = routeUtils.parseArgument(req.params, 'height', 'uint');
			const pagingOptions = routeUtils.parsePagingArguments(req.params);

			const operation = () => db.transactionsAtHeight(height, pagingOptions.id, pagingOptions.pageSize);
			return dbFacade.runHeightDependentOperation(db, height, operation)
				.then(result => {
					if (!result.isRequestValid) {
						res.send(errors.createNotFoundError(height));
						return next();
					}

					return routeUtils.createSender(routeResultTypes.transaction).sendArray('height', res, next)(result.payload);
				});
		});

		server.get('/blocks/:height/limit/:limit', (req, res, next) => {
			const height = routeUtils.parseArgument(req.params, 'height', 'uint');
			const limit = routeUtils.parseEnumeratedArgument(req.params, 'limit', validPageSizes, 'uint');

			const sanitizedLimit = limit || validPageSizes[0];
			const sanitizedHeight = alignDown(height || 1, sanitizedLimit);
			if (sanitizedHeight !== height || !limit)
				return res.redirect(`/blocks/${sanitizedHeight}/limit/${sanitizedLimit}`, next); // redirect calls next

			return db.blocksFrom(height, limit).then(blocks => {
				res.send({ payload: blocks, type: routeResultTypes.block });
				next();
			});
		});

		// CURSORS

		// Gets blocks up to the height (non-inclusive).
		// The height may be:
		//	- latest (returning from the latest block).
		//	- earliest (returning from the earliest block, IE, nothing).
		//	- A block height (as a number).
		server.get('/blocks/from/:height/limit/:limit', (req, res, next) => {
			const collectionName = 'blocks';
			const redirectUrl = (height, limit) => `/blocks/from/${height}/limit/${limit}`;
			const duration = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.block;
			return getBlocks(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// Gets blocks starting from the height (non-inclusive).
		// The height may be:
		//	- latest (returning since the latest block, IE, nothing).
		//	- earliest (returning since the earliest block).
		//	- A block height (as a number).
		server.get('/blocks/since/:height/limit/:limit', (req, res, next) => {
			const collectionName = 'blocks';
			const redirectUrl = (height, limit) => `/blocks/since/${height}/limit/${limit}`;
			const duration = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.block;
			return getBlocks(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/blocks/from/:height/limit/:limit/height', (req, res, next) => {
			const collectionName = 'blocks';
			const redirectUrl = (height, limit) => `/blocks/from/${height}/limit/${limit}/height`;
			const duration = 'From';
			const transformer = (info) => { return { height: info.block.height }; };
			const resultType = routeResultTypes.blockHeight;
			return getBlocks(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/blocks/since/:height/limit/:limit/height', (req, res, next) => {
			const collectionName = 'blocks';
			const redirectUrl = (height, limit) => `/blocks/since/${height}/limit/${limit}/height`;
			const duration = 'Since';
			const transformer = (info) => { return { height: info.block.height }; };
			const resultType = routeResultTypes.blockHeight;
			return getBlocks(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
		});
	}
};
