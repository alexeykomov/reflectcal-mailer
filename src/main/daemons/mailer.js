/*
 * Copyright (c) 2015. Reflect, Alex K.
 */

/**
 * @fileoverview Mailer daemon.
 * @author alexeykofficial@gmail.com (Alex K.)
 */


import * as appConfig from '../config/appconfig';
import * as Q from 'q';
import { db } from '../db/connection.js'
import { install } from 'source-map-support';
import { mail } from './mailer-core';
require('google-closure-library/closure/goog/bootstrap/nodejs');
goog.require('goog.array');


const log = appConfig.log;
const SECOND = 1000;
const MINUTE = SECOND * 60;
const FIFTEEN_MINUTES = MINUTE * 15;
var checkTimer;


install();


export const Mailer = {
  start: start,
  stop: stop,
}


function start() {
  checkTimer = setTimeout(notificationLoopCallback, SECOND);

  console.log('Started mailer daemon');
}


function stop() {
  clearTimeout(checkTimer);
}


var lastCheckedTime = 0;


function notificationLoopCallback() {
  var eventsToNotifyOf;

  var now = new Date;
  now.setSeconds(0);
  now.setMilliseconds(0);

  var nowTime = now.getTime();


  //Allow body to run every minute.
  if (nowTime != lastCheckedTime) {
    console.log('Current moment: ', new Date(nowTime).toISOString());
    lastCheckedTime = nowTime;

    onMinuteCallback(nowTime);
  }
  checkTimer = setTimeout(notificationLoopCallback, SECOND);
}


export var filterUpcomingEvents = (aNowTime, aEvents) => {
  var upcomingEvents = aEvents.filter(aEvent => {
    var eventStartTime = aEvent.start;
    return (aEvent.alerts || []).some(aAlert => {
      var intervalStart = aNowTime + aAlert.interval;
      var intervalEnd = intervalStart + MINUTE;
      return 3 == aAlert.type && eventStartTime >= intervalStart &&
          eventStartTime < intervalEnd;
    })
  })

  upcomingEvents.forEach(aEvent => {
    (aEvent.alerts || []).filter(aAlert => 3 == aAlert.type).forEach(aAlert => {
      var intervalStart = aNowTime + aAlert.interval;
      var intervalEnd = intervalStart + MINUTE;
      console.log('Will notify about event ', aEvent.name,
          ' which starts somewhere between ',
          new Date(intervalStart).toISOString(), ' and ',
          new Date(intervalEnd).toISOString());

    })
  });

  return upcomingEvents;
}


function onMinuteCallback(aNowTime) {
  var getUsersForCalendarIdWithPromiseWithBoundDb =
      getUsersForCalendarIdWithPromise.bind(this, getCalendarsWithPromise);

  getCloseEventsWithPromise({}).
      then(filterUpcomingEvents.bind(this, aNowTime)).
      then(aUpcomingEvents => goog.array.bucket(aUpcomingEvents, aEvent =>
          aEvent.calendarId)).
      then(groupByUserName.bind(this,
          getUsersForCalendarIdWithPromiseWithBoundDb)).
      then(mail).
      then(aResponses => console.log('Mail sent, total: ' + aResponses.length)).
      catch(aError => {
        console.log(aError, aError.stack);
        log(aError, aError.stack);
      });
}


export var groupByUserName = (aGetUsersForCalendarIdWithPromise,
    aGroupedByCalendar) => {
  return new Promise((resolve, reject) => {
    var userNamesPromises = [];
    var eventGroups = [];
    var usersToEvents = new Map();
    for (let calendarId in aGroupedByCalendar) {
      userNamesPromises.push(aGetUsersForCalendarIdWithPromise(calendarId));
      eventGroups.push(aGroupedByCalendar[calendarId]);
    }

    if (userNamesPromises.length) {
      Promise.all(userNamesPromises).then(aUserNameGroups => {
        aUserNameGroups.forEach((aUserNames, aIndex) => {
          aUserNames.forEach(aUserName => {
            if (!usersToEvents.has(aUserName)) {
              usersToEvents.set(aUserName, []);
            }
            usersToEvents.get(aUserName).push(...eventGroups[aIndex]);
          })
        })
        resolve(usersToEvents);
      }, reject);
    } else {
      resolve(usersToEvents);
    }
  })
}


function getCalendarsWithPromise(aCalendarId) {
  db.bind('calendars');
  var find = db.calendars.findItems;
  var findWithPromise = Q.default.denodeify(find.bind(db.calendars));
  return findWithPromise({_id: aCalendarId});
}


export function getUsersForCalendarIdWithPromise(aGetCalendarsWithPromise,
    aCalendarId) {
  return new Promise(function(resolve, reject) {
    aGetCalendarsWithPromise(aCalendarId).then(aCalendars => {
      var alreadyAdded = new Set();
      var userNames = [];
      aCalendars.forEach(aCalendar => {
        [aCalendar.owner].concat(aCalendar.viewers || []).
            concat(aCalendar.editors || []).forEach(aUserName => {
          if (!alreadyAdded.has(aUserName)) {
            alreadyAdded.add(aUserName);
            userNames.push(aUserName);
          }
        })
      });
      resolve(userNames);
      return userNames;
    }, reject);
  })
}


export function getCloseEventsWithPromise(aLookupObject) {
  return new Promise(function(resolve, reject) {
    db.bind('events');
    var find = db.events.findItems;
    var findWithPromise = Q.default.denodeify(find.bind(db.events));
    findWithPromise(aLookupObject).then(resolve, reject);
  });
}


/**
 * @param {Array<rflect.cal.events.Event>} aEvents Events to be grouped.
 * @return {Array<{_1: goog.date.DateTime, _2: Array<rflect.cal.events.Event>}>}
 * Events grouped in form date -> array of events for this date.
 */
/*groupEventsByStartDate(aEvents) {
  var groupedEvents = [];
  //Phase 1: group events by start date.
  var eventBuckets = goog.array.bucket(aEvents, aEvent => {
    var date = new Date;
    date.setTime(aEvent.startDate.getTime());
    //We only group events with minute precision.
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date.getTime();
  });
  //Phase 2: sort buckets by start date.
  for (var key in eventBuckets) {
    var date = new goog.date.DateTime();
    date.setTime(+key);
    groupedEvents.push({
      _1: date,
      _2: eventBuckets[key]
    })
  }
  return groupedEvents.sort((a, b) => {
    var aTime = a._1.getTime();
    var bTime = b._1.getTime();
    return aTime > bTime ? 1 : (aTime < bTime ? -1 : 0);
  });
}*/


/**
 * @param {Array<{_1: goog.date.DateTime, _2: Array<rflect.cal.events.Event>}>}
 * aUpcomingEvents Sequence of date -> events.
 */
/*showAlert_(aUpcomingEvents) {
  var alertText = aUpcomingEvents.map(this.upcomingEventsEntryToText).
      filter(alertText => !!alertText).join('\n');

  if (goog.DEBUG)
    console.log('alertText: ', alertText);

  if (alertText) {
    this.showSystemNotification(alertText);
    //To make alert show after system notification.
    setTimeout(() => {
      alert(alertText);
    }, 0);
  }
}*/

/**
 * @param {{_1: goog.date.DateTime, _2: Array<rflect.cal.events.Event>}} aEntry
 * @return {string} Alert text.
 */
/*upcomingEventsEntryToText(aEntry) {
  var dateAhead = aEntry._1;
  var events = aEntry._2;
  var firstEvent = events[0];
  var alertText = "";

  if (firstEvent) {
    var formatStringDate = goog.i18n.DateTimeSymbols.DATEFORMATS[3].
        replace(/y+/, 'yyyy');
    var formatStringTime = goog.i18n.DateTimeSymbols.TIMEFORMATS[3];
    var otherEventsNumber = events.length - 1;

    alertText = (firstEvent.summary ||
        rflect.cal.i18n.Symbols.NO_NAME_EVENT) +
        (otherEventsNumber > 0 ?
        ' and ' + otherEventsNumber + ' other events start at ' :
        ' starts at ') +
        new goog.i18n.DateTimeFormat(formatStringDate).format(dateAhead) +
        ' ' +
        new goog.i18n.DateTimeFormat(formatStringTime).format(dateAhead);
  }
  return alertText;
}*/


