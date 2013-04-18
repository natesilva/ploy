#!/usr/bin/env node

var ploy = require('../');
var argv = require('optimist')
    .boolean([ 'q', 'quiet' ])
    .argv
;
var exec = require('child_process').exec;
var hyperquest = require('hyperquest');
var defined = require('defined');
var qs = require('querystring');
var split = require('split');
var through = require('through');

var fs = require('fs');
var path = require('path');

var cmd = argv._[0];
if (cmd === 'help' || argv.h || argv.help || process.argv.length <= 2) {
    var h = argv.h || argv.help || argv._[1];
    var helpFile = typeof h === 'string' ? h : 'usage';
    
    var rs = fs.createReadStream(__dirname + '/' + helpFile + '.txt')
    rs.on('error', function () {
        console.log('No help found for ' + h);
    });
    rs.pipe(process.stdout);
}
else if (cmd === 'list' || cmd === 'ls') {
    showList();
}
else if (cmd === 'move' || cmd === 'mv') {
    argv._.shift();
    var src = argv.src || argv._.shift();
    var dst = argv.dst || argv._.shift();
    getRemote(function (err, remote) {
        if (err) return error(err);
        
        var hq = hyperquest(remote + '/move/' + src + '/' + dst);
        hq.pipe(process.stdout);
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
else if (cmd === 'restart') {
    argv._.shift();
    var name = argv.name || argv._.shift();
    getRemote(function (err, remote) {
        if (err) return error(err);
        
        var hq = hyperquest(remote + '/restart/' + name);
        hq.pipe(process.stdout);
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
else if (cmd === 'remove' || cmd === 'rm') {
    argv._.shift();
    var name = argv.name || argv._.shift();
    getRemote(function (err, remote) {
        if (err) return error(err);
        
        var hq = hyperquest(remote + '/remove/' + name);
        hq.pipe(process.stdout);
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
else if (cmd === 'log' && argv._.length) {
    argv._.shift();
    var name = argv.name || argv._.shift();
    
    getRemote(function (err, remote) {
        if (err) return error(err);
        var begin = defined(argv.begin, argv.b);
        var end = defined(argv.end, argv.e);
        var follow = argv.follow || argv.f;
        
        if (argv.n === 0) {
            end = 0;
        }
        else if (argv.n !== undefined) {
            begin = -argv.n;
            end = undefined;
        }
        
        if (begin === undefined && process.stdout.rows) {
            begin = 2 - process.stdout.rows;
        }
        
        var params = { begin: begin, end: end, follow: follow };
        if (!params.format && !name
        && (process.stdout.isTTY || argv.color)
        && String(argv.color) !== 'false') {
            params.color = true;
        }
        if (params.color && !params.format) params.format = 'json';
        
        Object.keys(params).forEach(function (key) {
            if (params[key] === undefined) delete params[key];
        });
        
        var href = remote + '/log'
            + (name ? '/' + name : '')
            + '?' + qs.stringify(params)
        ;
        var hq = hyperquest(href);
        if (params.color) {
            var keys = [];
            hq.pipe(split()).pipe(through(function (line) {
                try { var msg = JSON.parse(line) }
                catch (e) { return console.log(line) }
                
                if (keys.indexOf(msg[0]) < 0) keys.push(msg[0]);
                var color = 31 + (keys.indexOf(msg[0]) % 6);
                process.stdout.write(
                    '\033[01;' + color + 'm[' + msg[0] + ']'
                    + '\033[0m ' + msg[1]
                );
            }));
        }
        else {
            hq.pipe(process.stdout);
        }
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
else if (true || cmd === 'server') {
    // `ploy` server mode without `ploy server` is scheduled for demolition
    if (cmd === 'server') argv._.shift();
    
    var dir = path.resolve(argv.dir || argv.d || argv._.shift() || '.');
    var authFile = argv.auth || argv.a;
    var opts = {
        repodir: path.join(dir, 'repo'),
        workdir: path.join(dir, 'work'),
        logdir: path.join(dir, 'log'),
        auth: authFile && JSON.parse(fs.readFileSync(authFile))
    };
    
    var server = ploy(opts);
    if (!argv.q && !argv.quiet) {
        server.on('spawn', function (ps) {
            ps.stdout.pipe(process.stdout, { end: false });
            ps.stderr.pipe(process.stderr, { end: false });
        });
    }
    server.listen(argv.port || argv.p || 80);
    
    if (argv.ca || argv.pfx) {
        var sopts = {};
        if (argv.ca) sopts.ca = fs.readFileSync(argv.ca);
        if (argv.key) sopts.key = fs.readFileSync(argv.key);
        if (argv.cert) sopts.cert = fs.readFileSync(argv.cert);
        if (argv.pfx) sopts.pfx = fs.readFileSync(argv.pfx);
        sopts.port = argv.sslPort || argv.s || 443;
        server.listen(sopts);
    }
}

function error (err) {
    console.error(err);
    process.exit(1);
}

function getRemote (cb) {
    getRemotes(function (err, remotes) {
        if (err) cb(err)
        else if (remotes.length === 0) {
            cb('No matching ploy remotes found. Add a remote or use -r.');
        }
        else if (remotes.length >= 2) {
            cb('More than one matching ploy remote. Disambiguate with -r.');
        }
        else cb(null, remotes[0]);
    });
}

function getRemotes (cb) {
    var r = argv.r || argv.remote;
    if (/^https?:/.test(r)) {
        if (!/\/_ploy\b/.test(r)) r = r.replace(/\/*$/, '/_ploy');
        return cb(null, [ r.replace(/\/_ploy\b.*/, '/_ploy') ]);
    }
    
    exec('git remote -v', function (err, stdout, stderr) {
        if (err) return cb(err);
        
        var remotes = stdout.split('\n').reduce(function (acc, line) {
            var xs = line.split(/\s+/);
            var name = xs[0], href = xs[1];
            var re = RegExp('^https?://[^?#]+/_ploy/[^?#]+\\.git$');
            if (re.test(href)) {
                acc[name] = href.replace(RegExp('/_ploy/.+'), '/_ploy');
            }
            return acc;
        }, {});
        
        if (r) cb(null, [ remotes[r] ].filter(Boolean));
        else cb(null, Object.keys(remotes).map(function (name) {
            return remotes[name];
        }));
    });
}

function showList (indent) {
    if (!indent) indent = 0;
    
    getRemote(function (err, remote) {
        if (err) return error(err);
        
        var hq = hyperquest(remote + '/list');
        hq.pipe(split()).pipe(through(function (line) {
            this.queue(Array(indent+1).join(' ') + line + '\n');
        })).pipe(process.stdout);
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
