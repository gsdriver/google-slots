# google-slots
Google Assistant function that wraps an Alexa Skill to play slot machine

This project demonstrates mapping code that can be used to take a Google Assistant intent and map it to an Alexa request. The request is then posted to an HTTPS endpoint that fronts a lambda function that implements Slot Machine.  The result is mapped back to the expected format to communicate with Google Home. 