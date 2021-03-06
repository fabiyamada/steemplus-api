let config=require("../config");
let sql=require("mssql");
let steem=require("steem");
let utils=require("../utils");
var getJSON = require('get-json')


var lastPermlink=null;
var appRouter = function (app) {

  app.get("/", function(req, res) {
    res.status(200).send("Welcome to our restful API!");
  });

// Get all the articles and comments where a given user is mentionned
// @parameter @username : username
app.get("/api/get-mentions/:username", function(req, res){
console.log(req.params.username);
  new sql.ConnectionPool(config.config_api).connect().then(pool => {
    return pool.request()
    .input("username","\@"+req.params.username+" ")
    .input("username2","%@"+req.params.username+" %")
    .query('SELECT TOP 100 url,created, permlink, root_title, title, author, REPLACE(LEFT(body,250),\'"\',\'\'\'\') AS body,category, parent_author, total_payout_value, pending_payout_value, net_votes, json_metadata\
    FROM (SELECT  TOP 500 url,created, permlink, root_title, title, author,body,category, parent_author, total_payout_value, pending_payout_value, net_votes, json_metadata\
    FROM Comments\
    WHERE CONTAINS(body, @username) ORDER BY created DESC ) AS subtable  \
    WHERE body LIKE @username2  \
    ')
  }).then(result => {
    res.status(200).send(result.recordsets[0]);
    sql.close();
  }).catch(error => {console.log(error);
    sql.close();});
});

// Get witness information for a given user
// @parameter @username : username
app.get("/api/get-witness/:username", function(req, res){
  new sql.ConnectionPool(config.config_api).connect().then(pool => {
    console.log("connected");
    return pool.request()
    .input("username",req.params.username)
    .query('SELECT lastWeekValue, lastMonthValue, lastYearValue, foreverValue, timestamp, Witnesses.* \
FROM (SELECT SUM(vesting_shares) as lastWeekValue FROM VOProducerRewards WHERE producer = @username AND timestamp >= DATEADD(day,-7, GETUTCDATE())) as lastWeekTable, \
(SELECT SUM(vesting_shares) as lastMonthValue FROM VOProducerRewards WHERE producer = @username AND timestamp >= DATEADD(day,-31, GETUTCDATE())) as lastMonthTable, \
(SELECT SUM(vesting_shares) as lastYearValue FROM VOProducerRewards WHERE producer = @username AND timestamp >= DATEADD(day,-365, GETUTCDATE())) as lastYearTable, \
(SELECT SUM(vesting_shares) as ForeverValue FROM VOProducerRewards WHERE producer = @username ) as foreverTable, Witnesses \
LEFT JOIN Blocks ON Witnesses.last_confirmed_block_num = Blocks.block_num \
WHERE Witnesses.name = @username')
  }).then(result => {
    res.status(200).send(result.recordsets[0][0]);
    sql.close();
  }).catch(error => {console.log(error);
  sql.close();});
});

// Get witness ranking. This request doesn't include inactive witnesses
// No parameter!
app.get("/api/get-witnesses-rank", function(req, res){
  new sql.ConnectionPool(config.config_api).connect().then(pool => {
    console.log("connected");
    return pool.request()
    .query('Select Witnesses.name, rank\
  from Witnesses (NOLOCK)\
  LEFT JOIN (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT votes) DESC) AS rank, * FROM Witnesses WHERE signing_key != \'STM1111111111111111111111111111111114T1Anm\') AS rankedTable ON Witnesses.name = rankedTable.name;')
  }).then(result => {
    res.status(200).send(result.recordsets[0]);
    sql.close();
  }).catch(error => {console.log(error);
  sql.close();});
});

// Get all the received witness votes for a given user. Includes proxified votes
// @parameter @username : username
app.get("/api/get-received-witness-votes/:username", function(req, res){
  new sql.ConnectionPool(config.config_api).connect().then(pool => {
    console.log("connected");
    return pool.request()
    .input("username2","%"+req.params.username+"%")
    .input("username",req.params.username)
    .query("SELECT MyAccounts.timestamp, MyAccounts.account, (ISNULL(TRY_CONVERT(float,REPLACE(value_proxy,'VESTS','')),0) + TRY_CONVERT(float,REPLACE(vesting_shares,'VESTS',''))) as totalVests, TRY_CONVERT(float,REPLACE(vesting_shares,'VESTS','')) as accountVests, ISNULL(TRY_CONVERT(float,REPLACE(value_proxy,'VESTS','')),0) as proxiedVests \
            FROM (SELECT B.timestamp, B.account,A.vesting_shares FROM Accounts A, (select timestamp, account from TxAccountWitnessVotes where ID IN (select MAX(ID)as last from TxAccountWitnessVotes where witness=@username group by account) and approve=1)as B where B.account=A.name)as MyAccounts LEFT JOIN(SELECT proxy as name,SUM(TRY_CONVERT(float,REPLACE(vesting_shares,'VESTS',''))) as value_proxy FROM Accounts WHERE proxy IN ( SELECT name FROM Accounts WHERE witness_votes LIKE @username2 and proxy != '')GROUP BY(proxy))as proxy_table ON MyAccounts.account=proxy_table.name")})
    .then(result => {
    res.status(200).send(result.recordsets[0]);
    sql.close();
  }).catch(error => {console.log(error);
  sql.close();});
});


// Get all the incoming delegations for a given user
// @parameter @username : username
app.get("/api/get-incoming-delegations/:username", function(req, res){
  new sql.ConnectionPool(config.config_api).connect().then(pool => {
    console.log("connected");
    return pool.request()
    .input("username",req.params.username)
    .query("SELECT delegator, vesting_shares, timestamp as delegation_date \
            FROM TxDelegateVestingShares \
            INNER JOIN ( \
              SELECT MAX(ID) as last_delegation_id \
              FROM TxDelegateVestingShares \
              WHERE delegatee = @username \
              GROUP BY delegator \
            ) AS Data ON TxDelegateVestingShares.ID = Data.last_delegation_id")})
    .then(result => {
    res.status(200).send(result.recordsets[0]);
    sql.close();
  }).catch(error => {console.log(error);
  sql.close();});
});

// Get all the wallet information for a given user
// @parameter @username : username
app.get("/api/get-wallet-content/:username", function(req, res){
  new sql.ConnectionPool(config.config_api).connect().then(pool => {
    console.log("connected");
    return pool.request()
    .input("username",req.params.username)
    .query("select top 500 *\
      from (\
      select top 500 timestamp, reward_steem, reward_sbd, reward_vests, '' as amount, '' as amount_symbol, 'claim' as type, '' as memo, '' as to_from \
      from TxClaimRewardBalances where account = @username ORDER BY timestamp desc\
      union all\
      select top 500 timestamp, '', '', '',amount, amount_symbol, 'transfer_to' as type, ISNULL(REPLACE(memo, '\"', '\'\''), '') as memo, \"from\" as to_froms from TxTransfers where [to] = @username ORDER BY timestamp desc\
      union all\
      select top 500 timestamp, '', '', '', amount, amount_symbol, 'transfer_from' as type, ISNULL(REPLACE(memo, '\"', '\'''), '') as memo , \"to\" as to_from from TxTransfers where [from] = @username ORDER BY timestamp desc \
    ) as wallet_history ORDER BY timestamp desc ")})
    .then(result => {
    res.status(200).send(result.recordsets[0]);
    sql.close();
  }).catch(error => {console.log(error);
  sql.close();});
});


// Routine for welcoming new users on the platform and direct them to SteemPlus.

app.get("/job/welcome-users/:key", function(req, res){
  if(req.params.key==config.key){
    var query = {
      tag: 'introduceyourself',
      limit: 28
    }
    var chromeExtensionWebstoreURL = 'https://chrome.google.com/webstore/detail/steemplus/mjbkjgcplmaneajhcbegoffkedeankaj?hl=en';
    getJSON('http://www.whateverorigin.org/get?url=' + encodeURIComponent(chromeExtensionWebstoreURL),function(e,response){
      //console.log(response);
      var numUsers = ((""+response.contents.match(/<Attribute name=\"user_count\">([\d]*?)<\/Attribute>/))).split(",")[1];
      console.log(numUsers);

    steem.api.getDiscussionsByAuthorBeforeDateAsync('steem-plus',null, new Date().toISOString().split('.')[0],1).then(function(r,e){
      //console.log(e,r);
      steem.api.getDiscussionsByCreated(query, function(err, results) {
        console.log(results);
        var break_point=-1;
        if(err==null&&results.length!=0){
          results.forEach((result,i)=>{
            if(result.permlink==lastPermlink)
            {
              break_point=i;
              return;
            }
            else if (break_point!=-1)
              return;
            console.log(i);
            setTimeout(function(){
            //console.log(result.author, result.permlink);
              steem.broadcast.comment(config.wif, result.author, result.permlink, config.bot, result.permlink+"-re-welcome-to-steemplus", "Welcome to SteemPlus", utils.commentNewUser(result,r[0],numUsers), {}, function(err, result) {
                console.log(err, result);
              });
            },i*21*1000);
          });
        }
        else if(err!==null)
          console.log(err);

          console.log("------------");
          console.log("---DONE-----");
          console.log("------------");
          res.status(200).send((break_point==-1?results.length:break_point)+" results treated!");
          lastPermlink=results[0].permlink;
        });
      });
    });
  }
  else {
    res.status(403).send("Permission denied");
  }
});

// Get all curation rewards, author rewards and benefactor rewards for a given user.
// @parameter @username : username
app.get("/api/get-rewards/:username", function(req, res){
  new sql.ConnectionPool(config.config_api).connect().then(pool => {
    return pool.request()
    .input("username",req.params.username)
    .query("SELECT * \
            FROM ( SELECT timestamp, author, permlink, -1 as pending_payout_value, TRY_CONVERT(float,REPLACE(reward,'VESTS','')) as reward, -1 as sbd_payout, -1 as steem_payout, -1 as vests_payout, '' as beneficiaries, type='paid_curation' FROM VOCurationRewards WHERE curator=@username AND timestamp >= DATEADD(day,-7, GETUTCDATE()) AND timestamp < GETUTCDATE() \
              UNION ALL \
              SELECT timestamp, author, permlink,  -1 as pending_payout_value, -1 as reward, sbd_payout, steem_payout, vesting_payout, '' as beneficiaries, type='paid_author' FROM VOAuthorRewards WHERE author=@username AND timestamp >= DATEADD(day,-7, GETUTCDATE()) AND timestamp < GETUTCDATE()  \
              UNION ALL \
              SELECT timestamp, author, permlink,  -1 as pending_payout_value,TRY_CONVERT(float,REPLACE(reward,'VESTS','')) as reward, -1 as sbd_payout, -1 as steem_payout, -1 as vests_payout, '' as beneficiaries, type='paid_benefactor' FROM VOCommentBenefactorRewards WHERE benefactor=@username AND timestamp >= DATEADD(day,-7, GETUTCDATE()) AND timestamp < GETUTCDATE() \
              UNION ALL \
              SELECT timestamp, author, permlink,  -1 as pending_payout_value,TRY_CONVERT(float,REPLACE(reward,'VESTS','')) as reward, -1 as sbd_payout, -1 as steem_payout, -1 as vests_payout, '' as beneficiaries, type='pending_curation' FROM VOCurationRewards WHERE curator=@username AND timestamp >= DATEADD(day,0, GETUTCDATE()) \
              UNION ALL \
              select created, author, permlink, pending_payout_value,  -1 as reward, -1 as sbd_payout, -1 as steem_payout, -1 as vesting_payout, beneficiaries, 'pending_author' from Comments WHERE author = @username and pending_payout_value > 0 AND created >= DATEADD(day, -7, GETUTCDATE())   \
              UNION ALL \
              SELECT timestamp, author, permlink,  -1 as pending_payout_value,TRY_CONVERT(float,REPLACE(reward,'VESTS','')) as reward, -1 as sbd_payout, -1 as steem_payout, -1 as vests_payout, '' as beneficiaries, type='pending_benefactor' FROM VOCommentBenefactorRewards WHERE benefactor=@username AND timestamp >= DATEADD(day,0, GETUTCDATE()) \
            ) as rewards \
            ORDER BY timestamp desc")})
    .then(result => {
    res.status(200).send(result.recordsets[0]);
    sql.close();
  }).catch(error => {console.log(error);
  sql.close();});
});

}

module.exports = appRouter;
