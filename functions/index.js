//
// This file is a wrapper over the core Alexa logic
// adopted for use with Google Assistant
//

'use strict';

const {
  dialogflow,
  BasicCard,
} = require('actions-on-google');
const functions = require('firebase-functions');
const app = dialogflow({debug: true});
const request = require('request');
const config = require('./config');

const intents = [
  {name: 'Default Welcome Intent', intent: 'LaunchRequest'},
  {name: 'Spin', intent: 'SpinIntent'},
  {name: 'Rules', intent: 'RulesIntent'},
  {name: 'Select', intent: 'SelectIntent'},
  {name: 'Help', intent: 'AMAZON.HelpIntent'},
  {name: 'Yes', intent: 'AMAZON.YesIntent'},
  {name: 'No', intent: 'AMAZON.NoIntent'},
  {name: 'Stop', intent: 'AMAZON.StopIntent'},
  {name: 'Next', intent: 'AMAZON.NextIntent'},
  {name: 'HighScore', intent: 'HighScoreIntent'},
];

// Add the slot-less intents
intents.forEach((value) => {
  app.intent(value.name, (conv) => {
    return new Promise((resolve, reject) => {
      const lambda = createAlexaCall(conv, value.intent);
      callAlexa(conv, lambda).then(resolve, reject);
    });
  });
});

// Special case for Bet which takes a slot
app.intent('Bet', (conv, {Amount}) => {
  return new Promise((resolve, reject) => {
    let slots;
    const amount = parseInt(Amount);
    if (!isNaN(amount)) {
      slots = {Amount: amount};
    }
    const lambda = createAlexaCall(conv, 'BetIntent', slots);
    callAlexa(conv, lambda).then(resolve, reject);
  });
});

// Set the DialogflowApp object to handle the HTTPS POST request.
exports.dialogflowFirebaseFulfillment = functions.https.onRequest(app);

function createAlexaCall(conv, intentName, slots) {
  const userId = (conv.user && conv.user.raw && conv.user.raw.userId)
    ? conv.user.raw.userId : 'UNKNOWN';
  const lambda = {
    'session': {
      'sessionId': 'SessionId.c88ec34d-28b0-46f6-a4c7-120d8fba8fa7',
      'application': {
        'applicationId': config.APPID,
      },
      'attributes': {'platform': 'google'},
      'user': {
        'userId': 'GA-' + userId,
      },
    },
    'request': {
      'requestId': 'EdwRequestId.26405959-e350-4dc0-8980-14cdc9a4e921',
      'timestamp': Date.now(),
    },
    'version': '1.0',
    'context': {
      'System': {
        'application': {
          'applicationId': config.APPID,
        },
        'user': {
          'userId': 'GA-' + userId,
        },
      },
    },
  };

  if (conv.surface.capabilities.has('actions.capability.SCREEN_OUTPUT')) {
    // We support display
    lambda.context.System.device = {
       'deviceId': 'GA-' + userId,
       'supportedInterfaces': {
         'AudioPlayer': {},
         'Display': {
           'templateVersion': '1.0',
           'markupVersion': '1.0',
         },
       },
     };
  }

  // Is this a LaunchRequest or intent?
  if (intentName == 'LaunchRequest') {
    lambda.request.type = 'LaunchRequest';
  } else {
    lambda.request.type = 'IntentRequest';
    lambda.request.intent = {
      'name': intentName,
      'slots': {},
    };

    if (slots) {
      let slot;
      for (slot in slots) {
        if (slot) {
          lambda.request.intent.slots[slot] = {
            'name': slot,
            'value': slots[slot],
          };
        }
      }
    }
  }

  // Do we have Alexa attributes
  if (!conv.data || (Object.keys(conv.data).length === 0)) {
    lambda.session.new = true;
    lambda.request.locale = (conv.user.locale) ? conv.user.locale : 'en-US';
  } else {
    const attributes = Object.assign({}, conv.data);
    lambda.session.attributes = Object.assign(lambda.session.attributes, attributes);
    lambda.session.new = false;
    lambda.request.locale = lambda.session.attributes.playerLocale;
  }

  return lambda;
}

function callAlexa(conv, lambda) {
  return new Promise((resolve, reject) => {
    const requestData = {
      FunctionName: 'SlotMachine_v6',
      clientId: config.CLIENTID,
      payload: lambda,
    };

    request({
      url: config.SERVICEURL,
      method: 'POST',
      json: true,
      body: requestData,
    }, (err, res, body) => {
      if (err) {
        console.log('Error calling lambda: ' + err.stack);
        reject();
      } else {
        const result = body;
        console.log(JSON.stringify(body));
        if (!result.response || !result.response.outputSpeech) {
          // I'm not sure what to do with this?
          console.log('No output speech returned.');
          console.log(JSON.stringify(result));
          reject();
        } else {
          // Map this back to a Google response
          const speech = (result.response.outputSpeech.ssml)
            ? result.response.outputSpeech.ssml
            : result.response.outputSpeech.text;
          const reprompt = (result.response.reprompt
            && result.response.reprompt.outputSpeech)
            ? result.response.reprompt.outputSpeech.ssml
            : undefined;

          let imageUrl;
          let imageTitle;
          let card;

          // See if there is an image to display
          if (result.response.directives) {
            result.response.directives.forEach((directive) => {
              if ((directive.type === 'Display.RenderTemplate') &&
                directive.template && (directive.template.type === 'BodyTemplate1')) {
                if (directive.template.backgroundImage &&
                  directive.template.backgroundImage.sources) {
                  imageUrl = directive.template.backgroundImage.sources[0].url;
                  imageTitle = (directive.template.title) ? directive.template.title : 'Slot Machine';
                }
              }
            });
          }
          if (imageUrl) {
            card = new BasicCard({
              title: imageTitle,
              image: {
                url: imageUrl,
                accessibilityText: imageTitle,
              },
              display: 'WHITE',
            });
          }

          // Set the attributes
          let field;
          for (field in conv.data) {
            if (field) {
              conv.data[field] = undefined;
            }
          }
          Object.assign(conv.data, result.sessionAttributes);

          // Send the response
          if (result.response.shouldEndSession) {
            conv.close(speech);
            if (card) {
              conv.close(card);
            }
          } else {
            if (reprompt) {
              conv.noInputs = [reprompt];
            }
            conv.ask(speech);
            if (card) {
              conv.ask(card);
            }
          }

          resolve();
        }
      }
    });
  });
}
