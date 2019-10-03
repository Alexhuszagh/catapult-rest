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

const parseHeight = params => routeUtils.parseArgument(params, 'height', 'uint');
const parseHeightOrTimeMod = params => routeUtils.parseArgument(params, 'height', 'uint_or_timemod');

const getLimit = (validLimits, params) => {
	const limit = routeUtils.parseArgument(params, 'limit', 'uint');
	return -1 === validLimits.indexOf(limit) ? undefined : limit;
};

const alignDown = (height, alignment) => (Math.floor((height - 1) / alignment) * alignment) + 1;

// Implied method to get blocks from or since height.
//	req - Request data.
// 	res - Response data.
//	next - Control flow callback.
// 	pageSizes - Array of valid page sizes.
// 	redirectUrl - Callback to get redirect URL.
//  direction - 'From' or 'Since'.
//  transformer - Callback to transform each element.
//  resultType - Data result type (for formatting).
const getBlocks = (req, res, next, db, pageSizes, redirectUrl, direction, transformer, resultType) => {
	const height = parseHeightOrTimeMod(req.params);
	const limit = getLimit(pageSizes, req.params);

	if (!limit) {
		return res.redirect(redirectUrl(req.params.height, pageSizes[0]), next);
	}

	return db['blocks' + direction + 'Height'](height, limit).then(blocks => {
		const data = blocks.map(transformer);
		res.send({ payload: data, type: resultType });
		next();
	});
};

module.exports = {
	register: (server, db, { config }) => {
		const validPageSizes = routeUtils.generateValidPageSizes(config.pageSize); // throws if there is not at least one valid page size

		server.get('/block/:height', (req, res, next) => {
			const height = parseHeight(req.params);

			return dbFacade.runHeightDependentOperation(db, height, () => db.blockAtHeight(height))
				.then(result => result.payload)
				.then(routeUtils.createSender(routeResultTypes.block).sendOne(height, res, next));
		});

		server.get(
			'/block/:height/transaction/:hash/merkle',
			routeUtils.blockRouteMerkleProcessor(db, 'numTransactions', 'transactionMerkleTree')
		);

		server.get('/block/:height/transactions', (req, res, next) => {
			const height = parseHeight(req.params);
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
			const height = parseHeight(req.params);
			const limit = getLimit(validPageSizes, req.params);

			const sanitizedLimit = limit || validPageSizes[0];
			const sanitizedHeight = alignDown(height || 1, sanitizedLimit);
			if (sanitizedHeight !== height || !limit)
				return res.redirect(`/blocks/${sanitizedHeight}/limit/${sanitizedLimit}`, next); // redirect calls next

			return db.blocksFrom(height, limit).then(blocks => {
				console.log(`blocks=${blocks}`)
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
			const redirectUrl = (height, pageSize) => `/blocks/from/${height}/limit/${pageSize}`;
			const direction = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.block;
			return getBlocks(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});

		// Gets blocks starting from the height (non-inclusive).
		// The height may be:
		//	- latest (returning since the latest block, IE, nothing).
		//	- earliest (returning since the earliest block).
		//	- A block height (as a number).
		server.get('/blocks/since/:height/limit/:limit', (req, res, next) => {
			const redirectUrl = (height, pageSize) => `/blocks/since/${height}/limit/${pageSize}`;
			const direction = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.block;
			return getBlocks(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/blocks/from/:height/limit/:limit/height', (req, res, next) => {
			const redirectUrl = (height, pageSize) => `/blocks/from/${height}/limit/${pageSize}/height`;
			const direction = 'From';
			const transformer = (info) => { return { height: info.block.height }; };
			const resultType = routeResultTypes.blockHeight;
			return getBlocks(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/blocks/since/:height/limit/:limit/height', (req, res, next) => {
			const redirectUrl = (height, pageSize) => `/blocks/since/${height}/limit/${pageSize}/height`;
			const direction = 'Since';
			const transformer = (info) => { return { height: info.block.height }; };
			const resultType = routeResultTypes.blockHeight;
			return getBlocks(req, res, next, db, validPageSizes, redirectUrl, direction, transformer, resultType);
		});
	}
};
