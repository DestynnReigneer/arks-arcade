'use strict';

// Jokes that pop up now and then during Uh-Oh. The server picks them (so a
// room sees the same joke on every phone, and the adult tiers only reach
// tables that were allowed the adult deck). Each level mixes in the clean
// jokes and the tier below, weighted toward its own. Jokes are [setup, punchline].

const JOKES = {
  kids: [
    ['Why did the card player bring a ladder?', 'To reach the high cards!'],
    ['Why are playing cards bad at hide-and-seek?', 'They always show their hand.'],
    ['Why did the deck of cards go to the doctor?', 'It had a bad case of the shuffles.'],
    ['What did the Draw Four say to the Draw Two?', 'Is that all you’ve got?'],
    ['Why did the Reverse card get a ticket?', 'It was going the wrong way!'],
    ['What do you call a card that tells jokes?', 'A wild card!'],
    ['What do you call a dinosaur that’s great at cards?', 'A Deck-o-saurus!'],
    ['Why did the Skip card bring a pillow?', 'It was planning to sit this one out.'],
    ['Why did the cookie go to the nurse?', 'It felt crummy.'],
    ['What do you call a fake noodle?', 'An impasta!'],
    ['How do you make a tissue dance?', 'Put a little boogie in it!'],
    ['Why can’t a bicycle stand up on its own?', 'It’s two tired.'],
    ['What do you call a bear with no teeth?', 'A gummy bear!'],
    ['Why did the scarecrow win an award?', 'He was outstanding in his field.'],
    ['What do you call a sleeping bull?', 'A bulldozer!'],
    ['Why was the card table so tired?', 'It had a lot on its plate… and its legs.']
  ],
  cheeky: [
    ['Why did the Wild card get kicked out of the bar?', 'It kept changing colors to match whoever was buying.'],
    ['What’s the difference between this game and my love life?', 'Here, somebody actually wants my cards.'],
    ['How is a Draw Four like a hangover?', 'You didn’t ask for it, and it lasts all night.'],
    ['Why did the Skip card break up with the Reverse?', 'It kept going back to its ex.'],
    ['What do you call a player with one card left?', 'Insufferable.'],
    ['I’d tell you a joke about wine…', '…but it needs time to breathe.'],
    ['How is dating like this game?', 'You start with seven options and end up stuck with one.'],
    ['What’s a bartender’s favorite card?', 'The Draw Two. Doubles all around.'],
    ['My dating app says I’m a wild card.', 'Apparently that means nobody wants to be stuck with me.'],
    ['Why did the card blush?', 'Somebody saw it face up.'],
    ['What’s the most romantic card in the deck?', 'The Gift. It gives without being asked… unlike some people.']
  ],
  spicy: [
    ['What’s the difference between your hand and a dumpster fire?', 'The dumpster fire is warm.'],
    ['How is this game like a family reunion?', 'Lots of yelling, and somebody’s getting screwed.'],
    ['Why did the Draw Four go to therapy?', 'Everyone just used it to hurt each other.'],
    ['What do you call someone holding twelve cards?', 'Fucked. The word is fucked.'],
    ['I’m not saying you’re bad at this game…', '…but the dog just asked to play your hand.'],
    ['Why did the drunk play a Reverse?', 'He’d been going the wrong way all night anyway.'],
    ['What do this game and a bar fight have in common?', 'Somebody always says "Oh, it’s on."'],
    ['Why is it called a Wild?', 'Because "Oh shit, I’m screwed" didn’t fit on the card.'],
    ['What’s worse than drawing four?', 'Drawing four, then remembering you texted your boss last night.'],
    ['How do you know who’s winning?', 'They’re the smug asshole with two cards.']
  ],
  filthy: [
    ['Why is this game like sex?', 'Somebody always finishes first and brags about it.'],
    ['What’s the difference between a Draw Four and a one-night stand?', 'You can bounce the Draw Four.'],
    ['Why did the Gift card feel used?', 'Everybody passed it around and nobody called after.'],
    ['How is a Reverse like a bad lay?', 'Just when it’s getting good, it goes the other way.'],
    ['Why is it called "Uh-Oh"?', 'Same thing you said last Friday when the condom broke.'],
    ['My hand is like my love life:', 'full of junk, and nobody wants to touch it.'],
    ['Why are card players great in bed?', 'They know how to handle a big stack.'],
    ['How is this game like a threesome?', 'Somebody’s always getting skipped.'],
    ['What’s the safe word for this game?', '"I’ll draw." Nobody stops anyway.'],
    ['Why did the Draw Two get a reputation?', 'It’s always going down on the next player.']
  ]
};

const MIX = {
  kids: ['kids'],
  cheeky: ['kids', 'cheeky', 'cheeky'],
  spicy: ['kids', 'cheeky', 'spicy', 'spicy'],
  filthy: ['kids', 'spicy', 'filthy', 'filthy']
};

function jokesFor(level) {
  return (MIX[level] || MIX.kids).flatMap(t => JOKES[t]);
}

module.exports = { JOKES, jokesFor };
