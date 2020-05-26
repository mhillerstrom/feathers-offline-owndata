
const test = require('./commons/helpers/service-events.test.js');
const Owndata = require('../src');

test(Owndata, 'owndata', false);
test(Owndata, 'owndata', true);
