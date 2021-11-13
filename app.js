require('dotenv').config();

const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cors = require('cors');
const async = require('async');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const app = express();
const fs = require('fs');

global.r;
global.CONSTANTS = {
	BASE_PATH: __dirname,
	PUBLIC_PATH: __dirname+'/public/',
	DB_CONFIG: require(__dirname+'/database.json')
}

global.Config = require(__dirname+'/app/config');
global.Helpers = require(__dirname+'/app/helpers');
global.Libraries = require(__dirname+'/app/libraries');
global.Middlewares = require(__dirname+'/app/middlewares');

function initDB() {
	return new Promise(async (resolve, reject) => {
		var active_database = CONSTANTS.DB_CONFIG[process.env.ACTIVE_DATABASE];
		if (active_database.dbdriver.toLowerCase().match(/(mongo|mongodb)/)) {
			const MongoDB = require('mongodb').MongoClient;
			if (active_database.dsn !== '') {
				const DBConfig = new MongoDB(active_database.dsn, { useUnifiedTopology: true });
				DBConfig.connect().then(connection => resolve({driver: 'mongodb', active_database: active_database, connection: connection})).catch(reject);
			} else {
				const DBConfig = new MongoDB('mongodb://'+active_database.host+':'+active_database.port, { useUnifiedTopology: true });
				DBConfig.connect().then(connection => resolve({driver: 'mongodb', active_database: active_database, connection: connection})).catch(reject);
			}
		} else if (active_database.dbdriver.toLowerCase().match(/(rethinkdb)/)) {
			r = require('rethinkdb');
			r.connect({
				host: active_database.host,
				port: active_database.port,
				user: active_database.username,
				password: active_database.password,
				db: active_database.password
			}, (error, connection) => {
				if (error) {
					reject(error);
				}

				resolve({driver: 'rethinkdb', active_database: active_database, connection: connection});
			});
		} else if (active_database.dbdriver.toLowerCase().match(/(mysqli?)/)) {
			const mysql = require('mysql2/promise');
			const { host, port, username, password, database, dbdriver } = active_database;
			const temp_connection = await mysql.createConnection({ host, port, user:username, password });
			await temp_connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);

			const Sequelize = Libraries.sequelize;
			const sequelize = new Sequelize.Sequelize(database, username, password, {
				host: host,
				port: (port !== 3306)?port:3306,
				dialect: dbdriver,
				logging: (process.env.APP_ENV == 'development')
			});

			resolve({ driver: 'sequelize', active_database: active_database, connection: sequelize });
		}
	});
}

async.waterfall([
	function (callback) {
		if (process.env.ENABLE_DATABASE == 'YES') {
			initDB().then(initialize_database => callback(null, initialize_database), error => callback(error)); // Initialize database config
		} else {
			callback(null);
		}
	},
	function(params, callback) {
		if (process.env.ENABLE_DATABASE == 'YES') {
			if (params.active_database.driver == 'mongodb') {
				callback(null, {driver: params.driver, active_database: params.active_database, database: params.connection.db(params.active_database.database)}); // Activation current database
			} else {
				callback(null, {driver: params.driver, active_database: params.active_database, database: params.connection}); // Activation current database
			}
		} else {
			if (typeof callback == 'function') {
				callback(null);
			} else {
				params(null);
			}
		}
	},
], function (error, result) {
	if (error) {
		console.log(error);
		process.exit(0);
	} else {
		if (process.env.ENABLE_DATABASE == 'YES') {
			global.DB = result.database; // define active database connection as global variable
			global.Models = require(__dirname+'/app/models');

			if (result.driver == 'mongodb') {
			} else if (result.driver == 'rethinkdb') {
			} else if (result.driver == 'sequelize') {
				Object.keys(Models).forEach((model) => {
					if (Models[model].connections !== undefined && Models[model].connections.indexOf(process.env.ACTIVE_DATABASE) !== -1)
					{
						var dbprefix = (result.active_database.dbprefix !== undefined && result.active_database.dbprefix !== '')?result.active_database.dbprefix:'';
						DB.define(dbprefix+model, Models[model].fields, Object.assign({
							freezeTableName: true,
							createdAt: 'created_at',
							updatedAt: 'updated_at'
						}, Models[model].config));
					}
				});				(async () => {
					await DB.sync({ force: Helpers.string.to_boolean(process.env.INITIALIZE_DB) });
				})();
			}

			if (process.env.INITIALIZE_DB) {
				var file_content = fs.readFileSync(CONSTANTS.BASE_PATH+'/.env', 'utf8');
				process.env.INITIALIZE_DB = false;
				file_content = file_content.replace('INITIALIZE_DB = true', 'INITIALIZE_DB = false');
				fs.writeFileSync(CONSTANTS.BASE_PATH+'/.env', file_content);
			}
		}
	}
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.use(logger('dev'));
app.use(session({
	secret: process.env.ENCRYPTION_KEY,
	resave: false,
	saveUninitialized: true,
	cookie: { secure: true }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin : (origin, callback) => { callback(null, true) }, credentials: true }));
app.use(cookieParser());
app.use(express.static(CONSTANTS.PUBLIC_PATH));

app.use('/', require(__dirname+'/routes/index'));
app.use('/users', require(__dirname+'/routes/users'));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
	next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
	// set locals, only providing error in development
	res.locals.message = err.message;
	res.locals.error = req.app.get('env') === 'development' ? err : {};

	// render the error page
	res.status(err.status || 500);
	res.render('error');
});

app.listen(process.env.HTTP_PORT || 3000);