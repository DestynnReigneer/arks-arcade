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
    ['Why was the card table so tired?', 'It had a lot on its plate… and its legs.'],
    ['What’s a card’s favorite kind of music?', 'Anything it can skip to!'],
    ['Why did the deck go to the gym?', 'To work on its shuffle.'],
    ['How do cards say goodbye?', '"Deal you later!"'],
    ['Why was the Skip card so relaxed?', 'It knew how to skip work.'],
    ['What’s a card player’s favorite snack?', 'Draw-ritos!'],
    ['Why did the Reverse card become a detective?', 'It always went to the crime scene.'],
    ['What did the red card say to the green card?', '"Stop! Now, go get your green card!"'],
    ['Why did the card bring a blanket?', 'It heard the deck was getting cold…']
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
    ['What’s the most romantic card in the deck?', 'The Gift. It gives without being asked… unlike some people.'],
    ['My strategy is like my diet:', 'hold what I’m dealt, swallow what cums.'],
    ['I don’t hold grudges.', 'I hold Draw "while on all" Fours and end up screwing only myself, but I’ve gotten good at it.'],
    ['This game has ended more friendships', 'than every Tinder swipe combined.'],
    ['Why don’t liquor and this game mix?', 'Two glasses in, every card looks hot.'],
    ['Shuffling counts as cardio', 'for people who refuse to use Reverse as a Cowgirl.'],
    ['Nothing says "I love you"', 'like a Skipped hand job before bed.'],
    ['What’s the difference between my hand and my laundry?', 'I’ll eventually deal with the laundry, need more socks.'],
    ['A Draw Four on Grandma', 'is how you find out who’s really in the will, or how she handled a train.']
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
    ['How do you know who’s winning?', 'They’re the smug asshole with two cards.'],
    ['This hand is so bad', 'it should come with lotion and a bottle of tequila.'],
    ['Draw Four me again', 'and I’m telling everyone what you did BEFORE the wedding.'],
    ['My cards are like my exes:', 'every fetish, no bad decision, no long term solution.'],
    ['Shuffle better, damn it.', 'I’ve had this same shitty hand since 2019.'],
    ['One card left', 'and suddenly everybody remembers how to be an asshole.'],
    ['Forgetting to call "Uh-Oh" should cost you', 'a shot. Or a clothing. Dealer’s choice.'],
    ['I’m not losing,', 'I’m just holding the whole damn deck so you don’t have to.'],
    ['Why is it called Reverse?', 'Because "Hell no, right back at you" didn’t fit.']
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
    ['Why did the Draw Two get a reputation?', 'It’s always going down on the next player.'],
    ['Draw Four:', 'hopefully not the only time I get on fours tonight.'],
    ['My hand is like my browser history:', 'way too big and counts of open porn tabs.'],
    ['Calling my last card is like my sex life:', 'loud, wet, and missed the element of surprise.'],
    ['Why did the Wild card bring lube?', 'It heard somebody was getting four.'],
    ['This game and my ex have one thing in common:', 'both screw me and call it a "wild choice."'],
    ['Shuffle like you mean it.', 'Nobody likes a limp wrist.'],
    ['I’m like this deck:', 'well-handled, a little sticky, and missing a few 6 and 9s.'],
    ['You skipped me again?', 'Bold move for someone who can’t find the clit.']
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
