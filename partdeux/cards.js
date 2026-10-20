'use strict';

// The spice levels and the funny names Uh-Oh's action cards wear. Kids get
// glitter bombs and cookie bribes, the adult levels get progressively
// filthier versions of the same jobs. Every card picks one of its type's
// variants, so a deck reads differently every game. (These names started out
// in Short Fuse, the bomb card game Uh-Oh replaced; the type keys are its.)

const LEVELS = {
  kids:   { id: 'kids',   label: 'Kids',   emoji: '🧒', adult: false, blurb: 'Glitter bombs and cookie bribes. Fine for everyone.' },
  cheeky: { id: 'cheeky', label: 'Cheeky', emoji: '🌶️', adult: true,  blurb: 'Innuendo and mild swearing. Date night.' },
  spicy:  { id: 'spicy',  label: 'Spicy',  emoji: '🌶️🌶️', adult: true, blurb: 'Crude, gross, lots of swearing.' },
  filthy: { id: 'filthy', label: 'Filthy', emoji: '🌶️🌶️🌶️', adult: true, blurb: 'No holds barred. Adults who know each other well.' }
};

// What each card does. Shown on every card, whatever it is called.
const RULES = {
  bomb: 'Draw this and you blow up — unless you have a Defuse.',
  defuse: 'Saves you from a bomb. Then hide the bomb back in the deck wherever you like.',
  skip: 'End your turn without drawing.',
  attack: 'End your turn without drawing. The next player takes two turns.',
  shuffle: 'Shuffle the draw pile.',
  peek: 'Secretly look at the top three cards of the draw pile.',
  favor: 'Pick a player. They must give you a card of their choice.',
  nope: 'Cancel an action. Play it any time — even on another Nope.',
  junk: 'Useless alone. Play a matching pair to steal a random card from someone.'
};

const JUNK_TYPES = ['junk1', 'junk2', 'junk3', 'junk4'];

// [emoji, name, quip]
const FLAVOR = {
  kids: {
    bomb: [['💣', 'Glitter Bomb', 'Sparkly, loud, and you are OUT!'], ['🎈', 'Water Balloon Bomb', 'SPLOOSH. Soaked and out.'], ['🧪', 'Slime Bomb', 'Gloop everywhere. You are out!']],
    defuse: [['✂️', 'Snip the Wire', 'Red or blue? You picked right.'], ['🪣', 'Bucket of Water', 'Fizzzzle… phew.'], ['🧸', 'Hug the Bomb', 'It just needed a cuddle.']],
    skip: [['😴', 'Nap Time', 'Wake me up next turn.'], ['🏃', 'Run Away!', 'Nope, nope, nope.'], ['🙈', 'Not Looking', 'If I can’t see it, it can’t see me.']],
    attack: [['🦖', 'Dino Stomp', 'STOMP! Your turn now. Twice.'], ['🌪️', 'Tornado Toss', 'Whoosh — it’s their problem now.'], ['🐝', 'Bee Swarm', 'Bzzzz! Two turns of bees for them.']],
    shuffle: [['🌀', 'Mix It Up', 'Round and round it goes.'], ['🎲', 'Shake Shake Shake', 'Shake it all about.'], ['🥣', 'Stir the Soup', 'Who knows what’s on top now?']],
    peek: [['🔭', 'Telescope', 'I spy with my little eye…'], ['🕵️', 'Sneaky Peek', 'Shhh. Just looking.'], ['🔮', 'Crystal Ball', 'I see… cards. Three of them.']],
    favor: [['🥺', 'Puppy Eyes', 'How could anyone say no?'], ['🍪', 'Cookie Bribe', 'A card for a cookie. Deal?'], ['🎁', 'Gimme Gimme', 'Sharing is caring!']],
    nope: [['✋', 'Nope!', 'Not today.'], ['🙅', 'No Way, José', 'Absolutely not.'], ['🛑', 'Stop Right There', 'Freeze!']],
    junk1: [['🦄', 'Unicorn Burp', 'Smells like rainbows.']],
    junk2: [['🥔', 'Potato With Legs', 'Where is it going?']],
    junk3: [['🐸', 'Frog in a Hat', 'Very fancy. Very froggy.']],
    junk4: [['🌮', 'Taco Cat', 'Spelled the same backwards.']]
  },
  cheeky: {
    bomb: [['📱', 'Drunk Text to Your Ex', 'Sent. Read. You’re out.'], ['🚶', 'Walk of Shame', 'Everyone saw. You’re out.'], ['🍆', 'Premature Detonation', 'Happens to everyone. You’re still out.']],
    defuse: [['🧯', 'Cold Shower', 'That calmed things down.'], ['🙊', 'Delete Search History', 'Nobody needs to know.'], ['🍷', 'Second Bottle of Wine', 'Somehow that fixed it.']],
    skip: [['🤕', 'Faking a Headache', 'Not tonight.'], ['🚪', 'Irish Exit', 'Gone without a goodbye.'], ['📵', 'Left on Read', 'Seen. Ignored.']],
    attack: [['💋', 'Booty Call', 'They’re up. Twice.'], ['🍑', 'Cheeky Slap', 'Your turn, sweet cheeks. Twice.'], ['🥃', 'Round of Shots', 'Double for the next player.']],
    shuffle: [['🛏️', 'Mess Up the Sheets', 'Things got rearranged.'], ['💃', 'Dance Floor Grind', 'Everyone’s mixed up now.'], ['🍾', 'Spin the Bottle', 'Who knows where it lands?']],
    peek: [['👀', 'Checking Out the Goods', 'Just window shopping.'], ['📸', 'Stalking Their Instagram', 'Scrolled back three years.'], ['🔍', 'Swiping Through', 'Left, left, right…']],
    favor: [['😘', 'Bat Your Eyelashes', 'Works every time.'], ['🍹', 'Buy Me a Drink', 'And a card while you’re at it.'], ['💸', 'Sugar Daddy', 'Pay up, handsome.']],
    nope: [['🙅‍♀️', 'Not Tonight, Babe', 'Rejected.'], ['🤚', 'Talk to the Hand', 'Cause the face ain’t listening.'], ['👈', 'Swipe Left', 'Hard pass.']],
    junk1: [['🍌', 'Suspicious Banana', 'Why is it in the bedroom?']],
    junk2: [['🧦', 'Sock on the Doorknob', 'Do not disturb.']],
    junk3: [['🦩', 'Flamingo in Lingerie', 'Stunning, honestly.']],
    junk4: [['🦛', 'Hot Tub Hippo', 'Room for one more.']]
  },
  spicy: {
    bomb: [['💩', 'Shart Attack', 'You trusted a fart. You’re out.'], ['🤮', 'Tequila Regret', 'Puked. Exploded. Done.'], ['💥', 'Holy Shit Bomb', 'Well, shit. You’re out.']],
    defuse: [['🧻', 'Emergency Toilet Paper', 'Crisis wiped away.'], ['🍺', 'Hair of the Dog', 'Fixed it with more booze.'], ['🩹', 'Duct Tape Everything', 'Good enough, fuck it.']],
    skip: [['🤢', 'Hungover, Calling In Sick', 'Not today, Satan.'], ['🚽', 'Taking a Dump', 'Back in twenty minutes.'], ['🖕', 'Fuck This, I’m Out', 'Bye.']],
    attack: [['🛌', 'Dutch Oven', 'Trap the next player under the covers. Two turns.'], ['💨', 'Crop Dust', 'Walk by, leave a gift. Two turns.'], ['🤬', 'Your Mom', 'Two turns. Your mom said so.']],
    shuffle: [['🌪️', 'Total Shitshow', 'Nobody knows what’s happening.'], ['🍻', 'Bar Fight', 'Chairs everywhere.'], ['🎉', 'Kegger', 'Everything got knocked over.']],
    peek: [['🚪', 'Peeking Under the Stall', 'Creepy, but useful.'], ['👃', 'Smell Test', 'Something stinks up there.'], ['📱', 'Reading Your Texts', 'Wow. Just wow.']],
    favor: [['💸', 'Pay Up, Asshole', 'You owe me.'], ['🍺', 'Beer Tax', 'Hand it over.'], ['🫵', 'Gimme That, Dickhead', 'Now.']],
    nope: [['🖕', 'Fuck No', 'Denied.'], ['🙅', 'Hell to the No', 'Not happening.'], ['🐂', 'Bullshit!', 'Called it.']],
    junk1: [['🦨', 'Skunk Fart', 'It lingers.']],
    junk2: [['🍔', '3 a.m. Drunk Burger', 'Regret in a bun.']],
    junk3: [['🤡', 'Hungover Clown', 'Honk… ow.']],
    junk4: [['🦡', 'Honey Badger Don’t Care', 'Doesn’t give a shit.']]
  },
  filthy: {
    bomb: [['🍆', 'Finished Too Soon', 'Embarrassing for everyone. You’re out.'], ['💦', 'Sticky Situation', 'No coming back from this. You’re out.'], ['🍑', 'Wrong Hole', 'Oh. Oh no. You’re out.']],
    defuse: [['🧴', 'Bottle of Lube', 'Slid right out of trouble.'], ['🍍', 'Safe Word', 'Pineapple! Bomb disarmed.'], ['🥒', 'Pull-Out Method', 'Worked this time. Don’t push your luck.']],
    skip: [['😮‍💨', 'Post-Nut Clarity', 'You need a minute.'], ['😴', 'Rolled Over and Fell Asleep', 'Classic.'], ['🤕', 'Pulled a Groin', 'Worth it.']],
    attack: [['🍑', 'Bend Over', 'Next player takes it twice.'], ['⛓️', 'Handcuffed to the Bed', 'Two turns. No escape.'], ['🌭', 'Double Stuffed', 'Two turns, all the way in.']],
    shuffle: [['🔑', 'Swingers’ Key Bowl', 'Everybody grab a new partner.'], ['🛋️', 'Orgy Pile-Up', 'Whose leg is that?'], ['📖', 'Kama Sutra Roulette', 'Page 69, apparently.']],
    peek: [['🪟', 'Peeping Tom', 'Enjoying the view?'], ['📹', 'Hidden Camera', 'For research.'], ['🕶️', 'Incognito Mode', 'Nobody saw you look.']],
    favor: [['💋', 'Will Do Anything For It', 'Anything.'], ['🍌', 'Blow Me', 'They give you a card. Their choice.'], ['💸', 'OnlyFans Subscription', 'Paid content. Hand it over.']],
    nope: [['🚫', 'Not in the Butt', 'Firm no.'], ['🙅', 'Hard Limit', 'Absolutely not.'], ['🛑', 'Safe Word: NOPE', 'Everything stops.']],
    junk1: [['🐙', 'Tentacle Enthusiast', 'We don’t ask questions.']],
    junk2: [['🐓', 'Big Cock Energy', 'Struts around like he owns the place.']],
    junk3: [['🍒', 'Nipple Tassel Cat', 'Spin, baby, spin.']],
    junk4: [['🦄', 'Unicorn Butt Plug', 'Magical, apparently.']]
  }
};

function levelOf(raw) {
  return LEVELS[raw] ? raw : 'kids';
}

function isJunk(type) {
  return JUNK_TYPES.includes(type);
}

// The public face of one card at one level.
function view(card, level) {
  if (!card) return null;
  const variants = FLAVOR[levelOf(level)][card.type];
  const [emoji, name, quip] = variants[card.variant % variants.length];
  return {
    id: card.id,
    type: card.type,
    kind: isJunk(card.type) ? 'junk' : card.type,
    emoji, name, quip,
    rule: RULES[isJunk(card.type) ? 'junk' : card.type]
  };
}

function listLevels() {
  return Object.values(LEVELS);
}

module.exports = { LEVELS, RULES, JUNK_TYPES, FLAVOR, levelOf, isJunk, view, listLevels };
