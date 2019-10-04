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
const routeResultTypes = require('./routeResultTypes');
const errors = require('../server/errors');
const catapult = require('catapult-sdk');

const { address } = catapult.model;
const { buildAuditPath, indexOfLeafWithHash } = catapult.crypto.merkle;
const { convert, uint64 } = catapult.utils;
const packetHeader = catapult.packet.header;
const constants = {
	sizes: {
		hexPublicKey: 64,
		addressEncoded: 40,
		hexHash256: 64,
		hash256: 32,
		hexHash512: 128,
		hash512: 64,
		hexObjectId: 24,
		hexNamespaceId: 16,
		hexMosaicId: 16
	}
};

const namedValidatorMap = {
	objectId: str => constants.sizes.hexObjectId === str.length && convert.isHexString(str),
	namespaceId: str => constants.sizes.hexNamespaceId === str.length && convert.isHexString(str),
	mosaicId: str => constants.sizes.hexMosaicId === str.length && convert.isHexString(str),
	address: str => constants.sizes.addressEncoded === str.length,
	publicKey: str => constants.sizes.hexPublicKey === str.length,
	hash256: str => constants.sizes.hexHash256 === str.length,
	hash512: str => constants.sizes.hexHash512 === str.length,
	earliest: str => str === 'earliest' || str === 'min',
	latest: str => str === 'latest' || str === 'max'
	// TODO(ahuszagh) Add other validators here, like richest, latest.
};

const namedParserMap = {
	objectId: str => {
		if (!namedValidatorMap.objectId(str))
			throw Error('must be 12-byte hex string');

		return str;
	},
	namespaceId: str => {
		if (!namedValidatorMap.namespaceId(str))
			throw Error('must be 8-byte hex string');

		return uint64.fromHex(str);
	},
	mosaicId: str => {
		if (!namedValidatorMap.mosaicId(str))
			throw Error('must be 8-byte hex string');

		return uint64.fromHex(str);
	},
	uint: str => {
		const result = convert.tryParseUint(str);
		if (undefined === result)
			throw Error('must be non-negative number');

		return result;
	},
	// Parse a unsigned integer or a time modifier.
	uintOrTimemod: str => {
		if (namedValidatorMap.earliest(str))
			return 0;
		if (namedValidatorMap.latest(str))
			return Number.MAX_SAFE_INTEGER;
		const result = convert.tryParseUint(str);
		if (undefined === result)
			throw Error('must be non-negative number');

		return result;
	},
	// TODO(ahuszagh) Add other uint_or_x types here.
	address: str => {
		if (namedValidatorMap.address(str))
			return address.stringToAddress(str);

		throw Error(`invalid length of address '${str.length}'`);
	},
	publicKey: str => {
		if (namedValidatorMap.publicKey(str))
			return convert.hexToUint8(str);

		throw Error(`invalid length of publicKey '${str.length}'`);
	},
	accountId: str => {
		if (namedValidatorMap.publicKey(str))
			return ['publicKey', convert.hexToUint8(str)];
		if (namedValidatorMap.address(str))
			return ['address', address.stringToAddress(str)];

		throw Error(`invalid length of account id '${str.length}'`);
	},
	hash256: str => {
		if (namedValidatorMap.hash256(str))
			return convert.hexToUint8(str);

		throw Error(`invalid length of hash256 '${str.length}'`);
	},
	hash512: str => {
		if (namedValidatorMap.has512(str))
			return convert.hexToUint8(str);

		throw Error(`invalid length of hash512 '${str.length}'`);
	}
};

const routeUtils = {
	/**
	 * Parses an argument and throws an invalid argument error if it is invalid.
	 * @param {object} args Container containing the argument to parse.
	 * @param {string} key Name of the argument to parse.
	 * @param {Function|string} parser Parser to use or the name of a named parser.
	 * @returns {object} Parsed value.
	 */
	parseArgument(args, key, parser) {
		try {
			return this.parseValue(args[key], parser);
		} catch (err) {
			throw errors.createInvalidArgumentError(`${key} has an invalid format`, err);
		}
	},

	/**
	 * Parses an argument and throws an invalid argument error if it is invalid.
	 * @param {object} args Container containing the argument to parse.
	 * @param {string} key Name of the argument to parse.
	 * @param {array} Array of valid parsed values.
	 * @param {Function|string} parser Parser to use or the name of a named parser.
	 * @returns {object} Parsed value.
	 */
	parseEnumeratedArgument(args, key, validValues, parser) {
		try {
			return this.parseEnumeratedValue(args[key], validValues, parser);
		} catch (err) {
			throw errors.createInvalidArgumentError(`${key} has an invalid format`, err);
		}
	},

	/**
	 * Parses a value.
	 * @param {any} str Value to parse.
	 * @param {Function|string} parser Parser to use or the name of a named parser.
	 * @returns {object} Parsed value.
	 */
	parseValue: (str, parser) => {
		return ('string' === typeof parser ? namedParserMap[parser] : parser)(str);
	},

	/**
	 * Parses a value with valid enumerated values.
	 * @param {any} str Value to parse.
	 * @param {array} Array of valid parsed values.
	 * @param {Function|string} parser Parser to use or the name of a named parser.
	 * @returns {object} Parsed value or undefined.
	 */
	parseEnumeratedValue(str, validValues, parser) {
		const value = this.parseValue(str, parser);
		return -1 === validValues.indexOf(value) ? undefined : value;
	},

	/**
	 * Validates a value to parse.
	 * @param {any} value Value to validate.
	 * @param {Function|string} validator Validator to use or the name of a named validator.
	 * @returns {object} Whether value is valid.
	 */
	validateValue: (value, validator) => {
		return ('string' === typeof validator ? namedValidatorMap[validator] : validator)(value);
	},

	/**
	 * Parses an argument as an array and throws an invalid argument error if any element is invalid.
	 * @param {object} args Container containing the argument to parse.
	 * @param {string} key Name of the argument to parse.
	 * @param {Function|string} parser Parser to use or the name of a named parser.
	 * @returns {object} Array with parsed values.
	 */
	parseArgumentAsArray: (args, key, parser) => {
		const realParser = 'string' === typeof parser ? namedParserMap[parser] : parser;
		if (!Array.isArray(args[key]))
			throw errors.createInvalidArgumentError(`${key} has an invalid format: not an array`);

		try {
			return args[key].map(realParser);
		} catch (err) {
			throw errors.createInvalidArgumentError(`element in array ${key} has an invalid format`, err);
		}
	},

	/**
	 * Parses optional paging arguments and throws an invalid argument error if any is invalid.
	 * @param {object} args Arguments to parse.
	 * @returns {object} Parsed paging options.
	 */
	parsePagingArguments: args => {
		const parsedOptions = { id: undefined, pageSize: 0 };
		const parsers = {
			id: { tryParse: str => (namedValidatorMap.objectId(str) ? str : undefined), type: 'object id' },
			pageSize: { tryParse: convert.tryParseUint, type: 'unsigned integer' }
		};

		Object.keys(parsedOptions).filter(key => args[key]).forEach(key => {
			const parser = parsers[key];
			parsedOptions[key] = parser.tryParse(args[key]);
			if (!parsedOptions[key])
				throw errors.createInvalidArgumentError(`${key} is not a valid ${parser.type}`);
		});

		return parsedOptions;
	},

	/**
	 * Generates valid page sizes from page size config.
	 * @param {object} config Page size config.
	 * @returns {object} Valid limits.
	 */
	generateValidPageSizes: config => {
		const pageSizes = [];
		const start = config.min + (0 === config.min % config.step ? 0 : config.step - (config.min % config.step));
		for (let pageSize = start; config.max >= pageSize; pageSize += config.step)
			pageSizes.push(pageSize);

		if (0 === pageSizes.length)
			throw Error('page size configuration does not specify any valid page sizes');

		return pageSizes;
	},

	/**
	 * Creates a sender for forwarding one or more objects of a given type.
	 * @param {module:routes/routeResultTypes} type Object type.
	 * @returns {object} Sender.
	 */
	createSender: type => ({
		/**
		 * Creates an array handler that forwards an array.
		 * @param {object} id Array identifier.
		 * @param {object} res Restify response object.
		 * @param {Function} next Restify next callback handler.
		 * @returns {Function} An appropriate array handler.
		 */
		sendArray(id, res, next) {
			return array => {
				if (!Array.isArray(array))
					res.send(errors.createInternalError(`error retrieving data for id: '${id}'`));
				else
					res.send({ payload: array, type });

				next();
			};
		},

		/**
		 * Creates an object handler that either forwards an object corresponding to an identifier
		 * or sends a not found error if no such object exists.
		 * @param {object} id Object identifier.
		 * @param {object} res Restify response object.
		 * @param {Function} next Restify next callback handler.
		 * @returns {Function} An appropriate object handler.
		 */
		sendOne(id, res, next) {
			const sendOneObject = object => {
				if (!object)
					res.send(errors.createNotFoundError(id));
				else
					res.send({ payload: object, type });
			};

			return object => {
				if (Array.isArray(object)) {
					if (2 <= object.length)
						res.send(errors.createInternalError(`error retrieving data for id: '${id}' (length ${object.length})`));
					else
						sendOneObject(object.length && object[0]);
				} else {
					sendOneObject(object);
				}

				next();
			};
		}
	}),

	/**
	 * Query and send duration collection to network.
	 * @param {object} res Restify response object.
	 * @param {Function} next Restify next callback handler.
	 * @param {object} db Catapult or plugin database utility.
	 * @param {string} dbMethod Name of database method to call.
	 * @param {array} dbArgs Arguments to database method.
	 * @param {Function} transformer Callback to transform returned data prior to sending.
	 * @param {string} resultType Response data type.
	 */
	queryAndSendDurationCollection: (res, next, db, dbMethod, dbArgs, transformer, resultType) => {
		db[dbMethod](...dbArgs).then(data => {
	    const transformed = data.map(transformer);
	    res.send({ payload: transformed, type: resultType });
	    next();
	  });
	},

	/**
	 * Adds GET and POST routes for looking up documents of a single type.
	 * @param {object} server Server on which to register the routes.
	 * @param {object} sender Sender to use for sending the results.
	 * @param {object} routeInfo Information about the routes.
	 * @param {Function} documentRetriever Lookup function for retrieving the documents.
	 * @param {Function|string} parser Parser to use or the name of a named parser.
	 */
	addGetPostDocumentRoutes: (server, sender, routeInfo, documentRetriever, parser) => {
		const routes = {
			get: `${routeInfo.base}/:${routeInfo.singular}`,
			post: `${routeInfo.base}`
		};
		if (routeInfo.postfixes) {
			routes.get += `/${routeInfo.postfixes.singular}`;
			routes.post += `/${routeInfo.postfixes.plural}`;
		}

		server.get(routes.get, (req, res, next) => {
			const key = routeUtils.parseArgument(req.params, routeInfo.singular, parser);
			return documentRetriever([key]).then(sender.sendOne(req.params[routeInfo.singular], res, next));
		});

		server.post(routes.post, (req, res, next) => {
			const keys = routeUtils.parseArgumentAsArray(req.params, routeInfo.plural, parser);
			return documentRetriever(keys).then(sender.sendArray(req.params[routeInfo.plural], res, next));
		});
	},

	/**
	 * Adds PUT route for sending a packet to an api server.
 	 * @param {object} server Server on which to register the routes.
 	 * @param {object} connections Api server connection pool.
	 * @param {object} routeInfo Information about the route.
	 * @param {Function} parser Parser to use to parse the route parameters into a packet payload.
	 */
	addPutPacketRoute: (server, connections, routeInfo, parser) => {
		const createPacketFromBuffer = (data, packetType) => {
			const length = packetHeader.size + data.length;
			const header = packetHeader.createBuffer(packetType, length);
			const buffers = [header, Buffer.from(data)];
			return Buffer.concat(buffers, length);
		};

		server.put(routeInfo.routeName, (req, res, next) => {
			const packetBuffer = createPacketFromBuffer(parser(req.params), routeInfo.packetType);
			return connections.lease()
				.then(connection => connection.send(packetBuffer))
				.then(() => {
					res.send(202, { message: `packet ${routeInfo.packetType} was pushed to the network via ${routeInfo.routeName}` });
					next();
				});
		});
	},

	/**
	 * Returns function for processing merkle tree path requests.
	 * @param {module:db/CatapultDb} db Catapult database.
	 * @param {string} blockMetaCountField Field name for block meta count.
	 * @param {string} blockMetaTreeField Field name for block meta merkle tree.
	 * @returns {Function} Restify response function to process merkle path requests.
	 */
	blockRouteMerkleProcessor: (db, blockMetaCountField, blockMetaTreeField) => (req, res, next) => {
		const height = routeUtils.parseArgument(req.params, 'height', 'uint');
		const hash = routeUtils.parseArgument(req.params, 'hash', 'hash256');

		return dbFacade.runHeightDependentOperation(db, height, () => db.blockWithMerkleTreeAtHeight(height, blockMetaTreeField))
			.then(result => {
				if (!result.isRequestValid) {
					res.send(errors.createNotFoundError(height));
					return next();
				}

				const block = result.payload;
				if (!block.meta[blockMetaCountField]) {
					res.send(errors.createInvalidArgumentError(`hash '${req.params.hash}' not included in block height '${height}'`));
					return next();
				}

				const merkleTree = {
					count: block.meta[blockMetaCountField],
					nodes: block.meta[blockMetaTreeField].map(merkleHash => merkleHash.buffer)
				};

				if (0 > indexOfLeafWithHash(hash, merkleTree)) {
					res.send(errors.createInvalidArgumentError(`hash '${req.params.hash}' not included in block height '${height}'`));
					return next();
				}

				const merklePath = buildAuditPath(hash, merkleTree);

				res.send({
					payload: { merklePath },
					type: routeResultTypes.merkleProofInfo
				});

				return next();
			});
	},

	/**
	 * Returns account public key from account address .
	 * @param {module:db/CatapultDb} db Catapult database.
	 * @param {Uint8Array} accountAddress Account address.
	 * @returns {Promise<Uint8Array>} Account public key.
	 */
	addressToPublicKey: (db, accountAddress) => db.addressToPublicKey(accountAddress)
		.then(result => {
			if (!result)
				return Promise.reject(Error('account not found'));

			return result.account.publicKey.buffer;
		})
};

module.exports = routeUtils;
