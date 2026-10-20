'use strict';

// Dare Devil's deck: [type, text]. {other} becomes a random other player.
// Each adult level mixes in the one below it, weighted toward its own.

const LEVELS = {
  kids: { id: 'kids', label: 'Family', emoji: '🧒', adult: false, blurb: 'Silly dares and goofy questions for everyone.' },
  cheeky: { id: 'cheeky', label: 'Cheeky', emoji: '🌶️', adult: true, blurb: 'Flirty dares and juicy truths. Date night.' },
  spicy: { id: 'spicy', label: 'Spicy', emoji: '🌶️🌶️', adult: true, blurb: 'Clothes start coming off.' },
  filthy: { id: 'filthy', label: 'Filthy', emoji: '🌶️🌶️🌶️', adult: true, blurb: 'No holds barred. Couples and close friends.' }
};

const TYPES = {
  dare: { emoji: '😈', label: 'Dare', points: 2 },
  truth: { emoji: '🙊', label: 'Truth', points: 1 },
  rule: { emoji: '📜', label: 'New rule', points: 1 },
  everyone: { emoji: '🙋', label: 'Everyone', points: 1 },
  pick: { emoji: '👉', label: 'Pick someone', points: 1 },
  challenge: { emoji: '🎯', label: 'Challenge', points: 2 },
  bomb: { emoji: '💣', label: 'Uh-Oh!', points: 3 }
};

const DECK = {
  kids: [
    ['dare', 'Do your best chicken dance for 10 seconds.'],
    ['dare', 'Talk like a pirate until your next turn.'],
    ['dare', 'Do 10 jumping jacks.'],
    ['dare', 'Sing the first line of any song… as badly as you can.'],
    ['dare', 'Do your best impression of {other}.'],
    ['dare', 'Walk like a penguin to the door and back.'],
    ['dare', 'Make the silliest face you can and hold it for 5 seconds.'],
    ['dare', 'Speak in a robot voice until your next turn.'],
    ['dare', 'Stand on one foot until your next turn.'],
    ['dare', 'Let {other} give you a new nickname for the rest of the game.'],
    ['dare', 'Make an animal noise. Everyone guesses the animal.'],
    ['dare', 'Pretend to be a T. rex eating dinner.'],
    ['dare', 'Hop on one foot while saying the alphabet.'],
    ['dare', 'Give {other} a compliment in a fancy accent.'],
    ['dare', 'Moonwalk across the room.'],
    ['truth', 'What\'s the silliest thing you\'ve ever been scared of?'],
    ['truth', 'What would you do with a million dollars?'],
    ['truth', 'What\'s your most embarrassing moment?'],
    ['truth', 'If you could have any superpower, what would it be?'],
    ['truth', 'What\'s the weirdest food you actually like?'],
    ['truth', 'Who here would survive a zombie apocalypse the longest?'],
    ['truth', 'What\'s something nobody here knows about you?'],
    ['truth', 'What\'s the worst gift you\'ve ever gotten?'],
    ['rule', 'New rule: nobody can say "yes" or "no". Slip up and lose a point.'],
    ['rule', 'New rule: clap twice before you talk.'],
    ['rule', 'New rule: {other} is royalty. Bow before you speak to them.'],
    ['rule', 'New rule: no pointing. Point and lose a point.'],
    ['everyone', 'Everyone does a silly victory dance!'],
    ['everyone', 'Everyone wearing blue: stand up and spin around.'],
    ['everyone', 'Last person to touch their nose does a dare from {other}.'],
    ['everyone', 'Everyone switch seats!'],
    ['pick', 'Pick someone to do 5 push-ups (wall push-ups count).'],
    ['pick', 'Pick someone to tell a joke. No laugh, they lose a point.'],
    ['challenge', 'Name 5 animals in 10 seconds. Go!'],
    ['challenge', 'Staring contest with {other}. First to blink loses a point.'],
    ['challenge', 'Rock, paper, scissors with {other}. Winner gets 2 points.'],
    ['challenge', 'Say "Irish wristwatch" 5 times fast.'],
    ['bomb', 'Uh-Oh! Do 20 jumping jacks, or lose 2 points.'],
    ['bomb', 'Uh-Oh! Let {other} pick any dare for you. No backing out.']
  ],
  cheeky: [
    ['dare', 'Give {other} your best pickup line.'],
    ['dare', 'Serenade {other} with one line of a love song.'],
    ['dare', 'Do your sexiest walk across the room.'],
    ['dare', 'Wink at everyone in the room, one at a time.'],
    ['dare', 'Give {other} a 30-second shoulder rub.'],
    ['dare', 'Show everyone the last photo in your camera roll.'],
    ['dare', 'Read your last text out loud.'],
    ['dare', 'Strike your best runway pose and hold it for 10 seconds.'],
    ['dare', 'Blow {other} a kiss and make it dramatic.'],
    ['dare', 'Let {other} style your hair however they want.'],
    ['truth', 'Who here would you go on a date with?'],
    ['truth', 'What\'s your biggest turn-on?'],
    ['truth', 'What\'s the most romantic thing you\'ve ever done?'],
    ['truth', 'Who was your first kiss, and how was it?'],
    ['truth', 'What\'s your worst date story?'],
    ['truth', 'Have you ever had a crush on a friend\'s partner?'],
    ['truth', 'What\'s the most embarrassing thing in your search history?'],
    ['truth', 'What\'s the cheesiest line that ever worked on you?'],
    ['rule', 'New rule: everyone calls {other} "gorgeous" until the next rule.'],
    ['rule', 'New rule: say a number and you drink (or lose a point).'],
    ['everyone', 'Everyone who\'s been on a dating app: drink, or confess your worst match.'],
    ['everyone', 'Vote: who\'s the biggest flirt here? They take 2 sips (or lose a point).'],
    ['everyone', 'Waterfall! Everyone drinks until the person before them stops.'],
    ['pick', 'Pick someone to kiss your cheek.'],
    ['pick', 'Pick someone to give you a flirty compliment.'],
    ['challenge', 'Eat a snack as seductively as you can at {other}. Whoever laughs first loses.'],
    ['challenge', 'Name 5 celebrity crushes in 10 seconds.'],
    ['bomb', 'Uh-Oh! Swap one piece of clothing with {other}, or take 3 sips.']
  ],
  spicy: [
    ['dare', 'Give {other} a 20-second lap dance.'],
    ['dare', 'Take off one piece of clothing.'],
    ['dare', 'Let {other} give you a hickey somewhere hidden.'],
    ['dare', 'Do your best fake orgasm noise.'],
    ['dare', 'Body shot off {other}, or kiss their neck if there are no shots.'],
    ['dare', 'Twerk for 10 seconds.'],
    ['dare', 'Text your ex "I miss you" and show everyone the reply. Or take 3 sips.'],
    ['dare', 'Kiss {other} for 5 seconds.'],
    ['dare', 'Let the group scroll through your camera roll for 10 seconds.'],
    ['dare', 'Show off your best bedroom move on a pillow.'],
    ['truth', 'Where\'s the weirdest place you\'ve had sex?'],
    ['truth', 'What\'s your body count?'],
    ['truth', 'What\'s your wildest fantasy?'],
    ['truth', 'Spit or swallow?'],
    ['truth', 'Have you ever sent nudes?'],
    ['truth', 'What\'s the kinkiest thing you\'ve tried?'],
    ['truth', 'Who here would you hook up with?'],
    ['truth', 'Have you ever been caught in the act?'],
    ['rule', 'New rule: no names. Say one and take off an item or drink 2.'],
    ['rule', 'New rule: {other} can give anyone one order, any time, until the next rule.'],
    ['everyone', 'Never have I ever had a one-night stand. If you have, drink.'],
    ['everyone', 'Everyone who\'s been skinny dipping: lose your top or drink 2.'],
    ['everyone', 'Everyone point at who\'s best in bed. Most votes drinks 3 (or loses a point).'],
    ['pick', 'Pick someone to take off one piece of your clothing.'],
    ['pick', 'Pick someone to spank you.'],
    ['challenge', 'Kiss {other} without using your hands. Longest kiss wins 2 points.'],
    ['challenge', 'Pass an ice cube mouth to mouth with {other}.'],
    ['bomb', 'Uh-Oh! Lose two items of clothing, or finish your drink.']
  ],
  filthy: [
    ['dare', 'Take off two items of clothing.'],
    ['dare', 'Let {other} kiss you anywhere they want for 10 seconds.'],
    ['dare', 'Show your favorite position with {other}. Clothes on… for now.'],
    ['dare', 'Lick whipped cream (or your drink) off {other}.'],
    ['dare', 'Moan {other}\'s name like you mean it.'],
    ['dare', 'Let {other} take off one item of your clothing with their teeth.'],
    ['dare', 'Give {other} a full-contact lap dance for 30 seconds.'],
    ['dare', 'Describe your last orgasm in detail.'],
    ['dare', 'Go topless until your next turn.'],
    ['dare', 'Let {other} spank you as hard as they want. Once.'],
    ['truth', 'What\'s the dirtiest thing you\'ve ever done in public?'],
    ['truth', 'What\'s a fantasy you\'ve never told anyone?'],
    ['truth', 'Rate the best sex you\'ve ever had from 1 to 10, and say why.'],
    ['truth', 'What\'s your favorite position, and why?'],
    ['truth', 'Have you ever had a threesome? Would you?'],
    ['truth', 'What\'s the filthiest text you\'ve ever sent?'],
    ['truth', 'What gets you there fastest?'],
    ['truth', 'Who here have you pictured naked?'],
    ['rule', 'New rule: laugh, and you take off an item of clothing.'],
    ['rule', 'New rule: {other} picks tonight\'s first position. Seriously.'],
    ['everyone', 'Never have I ever had sex in a car. Drink if you have.'],
    ['everyone', 'Everyone takes off one item. Last one done takes off two.'],
    ['everyone', 'Everyone moans on three. Worst moan drinks 3.'],
    ['pick', 'Pick someone to sit on your lap until your next turn.'],
    ['pick', 'Pick someone to touch you anywhere for 15 seconds.'],
    ['challenge', 'Seven minutes in heaven with {other}. Somewhere private.'],
    ['challenge', 'First to make {other} blush wins 2 points. You have 30 seconds.'],
    ['bomb', 'Uh-Oh! Strip down to your underwear, or chug your drink.']
  ]
};

const MIX = { kids: ['kids'], cheeky: ['kids', 'cheeky', 'cheeky'], spicy: ['cheeky', 'spicy', 'spicy'], filthy: ['spicy', 'filthy', 'filthy'] };
const levelOf = id => (LEVELS[id] ? id : 'kids');

// The full pool for a level, each card tagged with where it came from.
function pool(level) {
  return MIX[levelOf(level)].flatMap(tier => DECK[tier].map(([type, text], i) => ({ id: `${tier}-${i}`, type, text })));
}

module.exports = { LEVELS, TYPES, DECK, levelOf, pool };
