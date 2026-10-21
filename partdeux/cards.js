'use strict';

// The spice levels and the funny names Uh-Oh's action cards wear. Each name
// is written for what its card does: Reverse cards back up like a truck, the
// Draw Fours dump four cards on someone. Kids get volcanoes and cookie
// sharing; the adult levels get progressively filthier versions of the same
// jobs. Every card picks one of its kind's variants, so a deck reads
// differently every game.

const LEVELS = {
  kids:   { id: 'kids',   label: 'Kids',   emoji: '🧒', adult: false, blurb: 'Volcanoes, rainbows and cookie sharing. Fine for everyone.' },
  cheeky: { id: 'cheeky', label: 'Cheeky', emoji: '🌶️', adult: true,  blurb: 'Innuendo and mild swearing. Date night.' },
  spicy:  { id: 'spicy',  label: 'Spicy',  emoji: '🌶️🌶️', adult: true, blurb: 'Crude, gross, lots of swearing.' },
  filthy: { id: 'filthy', label: 'Filthy', emoji: '🌶️🌶️🌶️', adult: true, blurb: 'No holds barred. Adults who know each other well.' }
};

// [emoji, name, quip], by card kind
const FLAVOR = {
  kids: {
    skip: [['😴', 'Nap Time', 'Wake me up next turn.'], ['🙈', 'Not Looking', 'Can’t see you, can’t play.'], ['🚧', 'Road Closed', 'Detour! Wait your turn.']],
    draw2: [['🍝', 'Extra Helping', 'Two more on your plate!'], ['🎒', 'Homework Pile', 'Two more pages. Sorry!'], ['🐶', 'The Dog Brought It', 'Two cards, a little slobbery.']],
    reverse: [['🚚', 'Beep Beep, Backing Up', 'Everybody go the other way!'], ['🔄', 'Spin Around', 'Other way round now.'], ['🎢', 'Loop the Loop', 'Hang on, we’re going backward!']],
    nope: [['✋', 'Nope!', 'Not today.'], ['🙅', 'No Way, José', 'Absolutely not.'], ['🪃', 'Boomerang', 'Right back at you!']],
    gift: [['🎁', 'Surprise Present', 'Here, you have it!'], ['🍪', 'Cookie Share', 'Sharing is caring.'], ['📦', 'Special Delivery', 'Sign here, please.']],
    wild: [['🌈', 'Rainbow Magic', 'Any color you like.'], ['🎨', 'Paint Splash', 'Pick a color, any color.'], ['🦄', 'Unicorn Power', 'Magic! Choose a color.']],
    wild4: [['🌋', 'Volcano', 'Four cards erupt on the next player!'], ['🐘', 'Elephant Sit', 'Four cards, and an elephant.'], ['🌊', 'Tidal Wave', 'Four cards wash up next door.']]
  },
  cheeky: {
    skip: [['🚪', 'Irish Exit', 'Gone without a goodbye.'], ['📵', 'Left on Read', 'Seen. Ignored.'], ['🤕', 'Faking a Headache', 'Not tonight.']],
    draw2: [['🥃', 'Round of Shots', 'Two for you, sweetie.'], ['🍑', 'Cheeky Slap', 'Two cards, sweet cheeks.'], ['💋', 'Booty Call', 'Two more. You know you want them.']],
    reverse: [['🚚', 'Backing That Thing Up', 'Beep beep. Other way.'], ['💃', 'Back It Up', 'Reverse, baby.'], ['🔁', 'U-Turn at the Bar', 'We’re going home a different way.']],
    nope: [['🙅‍♀️', 'Not Tonight, Babe', 'Rejected.'], ['🤚', 'Talk to the Hand', 'Cause the face ain’t listening.'], ['👈', 'Swipe Left', 'Hard pass.']],
    gift: [['🍹', 'Buy You a Drink', 'This one’s on me.'], ['🧦', 'Sock on the Doorknob', 'Here, you deal with it.'], ['😘', 'Regift', 'I never liked it anyway.']],
    wild: [['🍾', 'Spin the Bottle', 'Wherever it lands.'], ['🎰', 'Feeling Lucky', 'Pick your color, hot stuff.'], ['🦩', 'Flamingo in Lingerie', 'Fabulous. Pick a color.']],
    wild4: [['📱', 'Drunk Text to Your Ex', 'Four cards of regret.'], ['🚶', 'Walk of Shame', 'Four cards and last night’s outfit.'], ['🍆', 'Premature Detonation', 'Four cards. It happens to everyone.']]
  },
  spicy: {
    skip: [['🚽', 'Taking a Dump', 'Back in twenty minutes.'], ['🤢', 'Hungover, Calling In Sick', 'Not today, Satan.'], ['🖕', 'Fuck This, I’m Out', 'Bye.']],
    draw2: [['💨', 'Crop Dust', 'Two cards and a smell.'], ['🍺', 'Beer Tax', 'Two more. Pay up.'], ['🤬', 'Your Mom', 'Two cards. Your mom said so.']],
    reverse: [['🚚', 'Beep Beep, Motherfucker', 'Backing up. Move.'], ['🔙', 'Hell No, Go Back', 'Other way, dumbass.'], ['🍻', 'Drunk U-Turn', 'Wrong way, again.']],
    nope: [['🖕', 'Fuck No', 'Denied.'], ['🐂', 'Bullshit!', 'Called it.'], ['🙅', 'Hell to the No', 'Not happening.']],
    gift: [['💩', 'Flaming Bag of Poo', 'Special delivery.'], ['🍔', '3 a.m. Drunk Burger', 'Half-eaten. All yours.'], ['🦨', 'Skunk in a Box', 'Enjoy, asshole.']],
    wild: [['🌪️', 'Total Shitshow', 'Nobody knows what color it is.'], ['🎉', 'Kegger', 'Pick a color, if you can see straight.'], ['🤡', 'Hungover Clown', 'Honk. Pick a color.']],
    wild4: [['💩', 'Shart Attack', 'Four cards. You trusted a fart.'], ['🤮', 'Tequila Regret', 'Four cards and a bucket.'], ['💥', 'Holy Shit', 'Four cards. Well, shit.']]
  },
  filthy: {
    skip: [['😮‍💨', 'Post-Nut Clarity', 'You need a minute.'], ['😴', 'Rolled Over and Fell Asleep', 'Classic.'], ['🤕', 'Pulled a Groin', 'Worth it.']],
    draw2: [['🌭', 'Double Stuffed', 'Two, all the way in.'], ['⛓️', 'Handcuffed to the Bed', 'Two cards. No escape.'], ['🍑', 'Bend Over', 'Take two.']],
    reverse: [['🚚', 'Backing It Up for Daddy', 'Beep beep. Reverse.'], ['🔄', 'Flip Me Over', 'Other side now.'], ['🍆', 'Pull Out and Turn Around', 'Changing direction.']],
    nope: [['🍍', 'Safe Word', 'Pineapple! Not happening.'], ['🧴', 'Slipped Right Out', 'Nope.'], ['🛑', 'Not in That Hole', 'Hard no.']],
    gift: [['💦', 'Sloppy Seconds', 'Here, you finish it.'], ['🎁', 'Happy Ending', 'A little something for you.'], ['🔑', 'Swingers’ Key Bowl', 'Your turn to take one home.']],
    wild: [['📖', 'Kama Sutra Roulette', 'Page 69. Pick a color.'], ['🛋️', 'Orgy Pile-Up', 'Whose color is this?'], ['🎲', 'Sex Dice', 'Roll for position. Pick a color.']],
    wild4: [['🍆', 'Finished Too Soon', 'Four cards. Embarrassing for everyone.'], ['💦', 'Sticky Situation', 'Four cards. No coming back from this.'], ['🍑', 'Wrong Hole', 'Four cards. Oh. Oh no.']]
  }
};

function levelOf(raw) {
  return LEVELS[raw] ? raw : 'kids';
}

function listLevels() {
  return Object.values(LEVELS);
}

module.exports = { LEVELS, FLAVOR, levelOf, listLevels };
