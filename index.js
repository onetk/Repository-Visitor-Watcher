// 設定を.envからロード
require('dotenv').config();

const GitHubApi = require('github');
const moment = require('moment');
const https = require('https');
const querystring = require('querystring');
const bluebird = require('bluebird');
const async = require('async');

// kintone 接続設定
const DOMAIN = 'subdomain.cybozu.com';
const APP_ID = process.env.KINTONE_APP_ID;
const API_TOKEN = process.env.KINTONE_API_TOKEN;

// GitHub 接続設定
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO_NAME;
const PERSONAL_ACCESS_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;



const github = new GitHubApi({
    protocol: 'https',
    host: 'api.github.com',
    Promise: bluebird
});

github.authenticate({
    type: 'token',
    token: PERSONAL_ACCESS_TOKEN
});

const getOptions = (apiPath, method) => {
    'use strict';

    return {
        hostname: DOMAIN,
        port: 443,
        path: apiPath,
        method: method,
        headers: {
            'X-Cybozu-API-Token': API_TOKEN
        }
    };
};

// kintone から一番直近に登録したデータの年月日を取得
const getRecord = (project, callback) => {
    'use strict';
    console.log('[START] get kintone record');

    const params = {
        app: APP_ID,
        query: `project = "${project}" order by date desc limit 1 offset 0`,
        fields: ['date']
    };
    const query = querystring.stringify(params);
    const options = getOptions('/k/v1/records.json?' + query, 'GET');

    const req = https.request(options, (res) => {
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
            if (res.statusCode === 200) {
                callback(null, JSON.parse(chunk).records);
            } else {
                callback(res.statusMessage);
            }
        });
    });

    req.on('error', (err) => {
        callback(err.message);
    });

    req.end();
};

// kintone に訪問数などを登録
const postRecord = (project, date, count, uniques, callback) => {
    'use strict';
    console.log(`[START] post kintone record: ${date}`);

    const params = {
        app: APP_ID,
        record: {
            project: {
                value: project
            },
            date: {
                value: date
            },
            count: {
                value: count
            },
            uniques: {
                value: uniques
            }
        }
    };

    const options = getOptions('/k/v1/record.json', 'POST');
    options.headers['Content-Type'] = 'application/json';

    const req = https.request(options, (res) => {
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
            if (res.statusCode === 200) {
                const body = JSON.parse(chunk);
                callback(null, body.id);
            } else {
                callback(res.statusMessage);
            }
        });
    });

    req.on('error', (err) => {
        callback(err.message);
    });

    req.write(JSON.stringify(params));
    req.end();
};

exports.handler = (event, context, callback) => {
    'use strict';

    const project = `${OWNER}/${REPO}`;
    getRecord(project, (err, records) => {
        'use strict';

        if (err !== null) {
            callback(err);
            return false;
        }

        const currentDate = moment();
        let lastDate = '';
        try {
            lastDate = moment(records[0].date.value);
        } catch (err) {
            lastDate = moment('2000-01-01');
        }

        github.repos.getViews({
            owner: OWNER,
            repo: REPO
        }).then((res, err) => {
            if (err !== undefined) {
                callback(err);
                return false;
            }

            const views = res.data.views;
            const postRecordHandlers = [];
            for (let i = 0; i < views.length; i++) {
                const view = views[i];
                const timestamp = view.timestamp;
                const count = view.count;
                const uniques = view.uniques;

                const date = moment(timestamp);

                // 一番直近に登録したデータの年月日以前の場合はスキップ
                if (date.isSameOrBefore(lastDate, 'day')) {
                    continue;
                }
                // 実行日と同じ年月日もスキップ
                if (date.isSame(currentDate, 'day')) {
                    continue;
                }
                postRecordHandlers.push(postRecord.bind(this, project, date.format('YYYY-MM-DD'), count, uniques));
            }

            if (postRecordHandlers.length === 0) {
                console.log('[COMPLETE] nothing to do');
                callback(null, '[COMPLETE] nothing to do');
                return false;
            }

            async.series(postRecordHandlers, (err, rid) => {
                if (err !== null) {
                    callback(err);
                    return false;
                }
                console.log('[COMPLETE] record id: ' + rid.join(', '));
                callback(null, '[COMPLETE] record id: ' + rid.join(', '));
            });
        });
    });

};
