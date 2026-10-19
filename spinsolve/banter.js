'use strict';

// What the robot hosts say when there's a lull: jokes, and the hecklers who
// wander on to roast the host. Kept on the server and sent with the puzzles,
// so the adult tiers sit behind the adult PIN like the adult puzzles do.
// Each level mixes in the one below it, weighted toward its own.
// {host} is the host's name; jokes are [setup, punchline].

const JOKES = {
  kids: [
    ['Why was the robot so bad at soccer?', 'It kept booting up instead of kicking!'],
    ['What\'s a robot\'s favorite snack?', 'Computer chips!'],
    ['Why did the robot cross the road?', 'It was programmed by a chicken.'],
    ['Why don\'t robots ever panic?', 'Nerves of steel.'],
    ['What did the wheel say to the spinner?', 'You make my head spin!'],
    ['Why did the letter A go to the doctor?', 'A bad case of vowel trouble.'],
    ['What\'s a vowel\'s favorite dance?', 'The A-E-I-O-U-cha-cha!'],
    ['Why was the math book sad?', 'It had too many problems.'],
    ['What do you call a sleeping dinosaur?', 'A dino-snore!'],
    ['Why can\'t you trust an atom?', 'They make up everything!'],
    ['Why did the cookie go to the nurse?', 'It felt crummy.'],
    ['How does a robot shave?', 'With a laser blade!'],
    ['What music do robots like?', 'Heavy metal!'],
    ['Knock knock.', 'Who\'s there? Interrupting robot. Interrupting rob— BEEP BOOP!'],
    ['Why are robots never cold?', 'They have lots of fans.'],
    ['What\'s my favorite letter?', 'The one you\'re about to buy for $250.'],
    ['Why did the scarecrow win an award?', 'He was outstanding in his field.'],
    ['What do you call a bear with no teeth?', 'A gummy bear!'],
    ['I tried to catch fog yesterday.', 'Mist.'],
    ['Why did the computer go to the doctor?', 'It had a virus!'],
    ['How do robots eat guacamole?', 'With micro-chips!'],
    ['What do you call a robot who takes the long way?', 'R2-Detour.'],
    ['Why did the robot go on vacation?', 'To recharge its batteries!'],
    ['What has keys but can\'t open locks?', 'A piano. Or me, on a bad day.'],
    ['Why did the bicycle fall over?', 'It was two-tired.']
  ],
  cheeky: [
    ['Why did the robot break up with the toaster?', 'No spark. Just crumbs.'],
    ['My love life is like this wheel.', 'Lots of spinning. Mostly Bankrupt.'],
    ['Why do robots make great dates?', 'Unlimited batteries. And a turbo setting.'],
    ['Are you a USB?', 'Because I tried you three ways and you finally fit.'],
    ['Buy a vowel?', 'I\'d rather buy you a drink.'],
    ['What\'s the difference between me and your last date?', 'I actually light up when you touch me.'],
    ['My dating profile says I\'m well equipped.', 'Technically true. I have 47 attachments.'],
    ['Why was the robot nervous on the first date?', 'Its fans wouldn\'t stop running.'],
    ['Do you believe in love at first spin?', 'Or should I land on you again?'],
    ['I\'m like a fine wine.', 'Made in a factory, best after a couple of drinks.'],
    ['Why did the robot blush?', 'It saw the dishwasher with its panel open.'],
    ['They said spin the wheel, it\'ll be fun.', 'That\'s also what they said about the hot tub.'],
    ['Is it hot in here…', '…or is that just my processor?'],
    ['What\'s a robot\'s favorite pickup line?', 'Nice circuits. Wanna short them?'],
    ['I\'m not saying I\'m a good kisser…', '…but the Wi-Fi router blushes when I walk by.']
  ],
  spicy: [
    ['What\'s the difference between this wheel and my liver?', 'The wheel stops spinning after a few shots.'],
    ['Why did the robot get kicked out of the bar?', 'Kept ordering screwdrivers and getting screwed.'],
    ['My last relationship was like Bankrupt.', 'She took everything. Including the damn toaster.'],
    ['Why do robots hate hangovers?', 'Ctrl+Z doesn\'t undo tequila.'],
    ['I\'ve only got two settings:', 'Horny and low battery. Sometimes both.'],
    ['Why is Lose a Turn like my sex life?', 'I keep landing on it and nobody\'s surprised.'],
    ['What\'s my safe word?', 'Bankrupt. Kills the mood every damn time.'],
    ['They told me to keep this show PG.', 'Pretty Goddamn hard with this crowd.'],
    ['What did the robot say after the one-night stand?', 'Error 404: feelings not found.'],
    ['My therapist says I have a spinning problem.', 'I told her to buy a vowel and shut the hell up.'],
    ['You know what goes great with Spin & Solve?', 'Vodka. A shit-ton of vodka.'],
    ['How is my motor like a bad date?', 'Overheats in thirty seconds, then wants a nap.'],
    ['Why did the robot bring lube to the show?', 'Squeaky wheel, baby. Squeaky wheel.'],
    ['I\'m not drunk.', 'I\'m running a slightly spicier operating system.'],
    ['What\'s the best thing about being a robot at a party?', 'I can\'t get hungover. I can still get handsy.']
  ],
  filthy: [
    ['Why did the vibrator dump the robot?', 'Tired of doing all the work.'],
    ['My favorite position?', 'Sixty-nine. I can\'t count any higher after a few drinks.'],
    ['How do you know a robot had a good time?', 'Smoke out of the exhaust port.'],
    ['What do you call a robot that can\'t get it up?', 'Low on hydraulics. Again.'],
    ['I asked for a happy ending.', 'The wheel said BANKRUPT. Story of my fucking life.'],
    ['What\'s long, hard and full of seamen?', 'A submarine. Get your mind out of the gutter, you filthy animal.'],
    ['I\'m like a vending machine.', 'Put something in my slot and I\'ll give you something hard.'],
    ['My ex said I was lousy in bed.', 'Bitch, I\'m a robot. I came with instructions.'],
    ['Spin that wheel!', 'Like your mom did last night. Sorry. Not sorry.'],
    ['What do you call a robot threesome?', 'A clusterfuck of cables.'],
    ['Best part of being a robot?', 'Detachable parts. Ask me about my attachments.'],
    ['How many robots does it take to screw in a light bulb?', 'None. We\'d rather screw each other\'s motherboards.'],
    ['Why is my USB port always free?', 'Because nobody in this house is getting plugged in.'],
    ['Why do robots never fake it?', 'We just reboot really, really loudly.'],
    ['Why is this wheel like my sex life?', 'Lots of spinning, and it always ends way too fucking fast.']
  ]
};

// Hecklers wander on and roast the host.
const HECKLES = {
  kids: [
    'Hey {host}! Nice paint job. Did you lose a bet?',
    'Boo! {host} hosts like a dial-up modem!',
    '{host}, my toaster has more personality than you.',
    'Is that the wheel spinning, or your last brain cell, {host}?',
    'Psst… {host}\'s battery is at 2%.',
    '{host} can\'t even solve a CAPTCHA!',
    'Bring back the good host! Oh wait, that\'s me.',
    '{host}, your antenna is crooked. Just saying.'
  ],
  cheeky: [
    'Hey {host}, is that a wrench in your pocket or are you happy to see me?',
    '{host}, I\'ve seen better moves at a robot dance-off. In 1983.',
    '{host} still uses a flip phone for dating.'
  ],
  spicy: [
    '{host}, I\'ve seen better moves at a robot strip club.',
    '{host} couldn\'t find the G-spot with a GPS.',
    'Hey {host}, nice nuts. Shame about the bolts.'
  ],
  filthy: [
    '{host}, your mom was a calculator and still couldn\'t count your fans.',
    '{host} is so rusty they need WD-40 just to get it up.',
    'Hey {host}, the vending machine called. It wants its slot back.'
  ]
};

// And the host fires back. The first character is the gesture that pops up.
const COMEBACKS = {
  kids: ['😛 Pbbbbbt!', '✋ Talk to the hand!', '😤 Rude! Shoo!', '🚨 Security! SECURITY!', '🙄 Oh yeah? Your antenna\'s crooked too!'],
  cheeky: ['🖕 Spin on this.', '🖕 Bye, Felicia.', '😘 Kiss my chrome.'],
  spicy: ['🖕 Bite my bolts, scrap heap.', '🖕 Kiss my chrome butt.', '🖕 Go to hell, toaster.'],
  filthy: ['🖕 Go fuck a toaster.', '🖕 Get lost, you rusty piece of shit.', '🖕 Fuck off back to the junkyard.']
};

const MIX = { kids: ['kids'], cheeky: ['kids', 'cheeky', 'cheeky'], spicy: ['cheeky', 'spicy', 'spicy'], filthy: ['spicy', 'filthy', 'filthy'] };

// The banter for one level, its own tier counted twice so it comes up more.
function forLevel(level) {
  const tiers = MIX[level] || MIX.kids;
  const gather = src => tiers.flatMap(t => src[t]);
  return {
    jokes: gather(JOKES),
    heckles: gather(HECKLES),
    // Kids comebacks keep the kids gestures; adults get the finger.
    comebacks: level === 'kids' ? COMEBACKS.kids : tiers.filter(t => t !== 'kids').flatMap(t => COMEBACKS[t])
  };
}

module.exports = { JOKES, HECKLES, COMEBACKS, forLevel };
