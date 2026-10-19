'use strict';

// Know-It-All's built-in content: questions for every level, couples dares,
// and drinking rules. The adult parts are only ever sent with the adult PIN.
// Questions are [genre, difficulty (e/m/h), question, correct, wrong, wrong, wrong].

const LEVELS = {
  kids: { id: 'kids', label: 'Family', emoji: '🧒', adult: false, blurb: 'Fun facts for everyone.' },
  cheeky: { id: 'cheeky', label: 'Cheeky', emoji: '🌶️', adult: true, blurb: 'Flirty facts, love songs and cocktails.' },
  spicy: { id: 'spicy', label: 'Spicy', emoji: '🌶️🌶️', adult: true, blurb: 'Sex facts, booze and dirty minds.' },
  filthy: { id: 'filthy', label: 'Filthy', emoji: '🌶️🌶️🌶️', adult: true, blurb: 'Explicit. For couples and close friends.' }
};
const levelOf = id => (LEVELS[id] ? id : 'kids');

const DIFF = { e: 'easy', m: 'medium', h: 'hard' };

const RAW = {
  kids: [
    ['Animals', 'e', 'What is the largest animal on Earth?', 'Blue whale', 'African elephant', 'Giraffe', 'Great white shark'],
    ['Animals', 'e', 'How many legs does a spider have?', '8', '6', '10', '12'],
    ['Animals', 'm', 'What is a baby kangaroo called?', 'Joey', 'Cub', 'Kit', 'Calf'],
    ['Animals', 'm', 'Which bird is famous for copying human speech?', 'Parrot', 'Pigeon', 'Owl', 'Robin'],
    ['Animals', 'h', 'What is the only mammal that can truly fly?', 'Bat', 'Flying squirrel', 'Sugar glider', 'Colugo'],
    ['Animals', 'e', 'What do giant pandas mostly eat?', 'Bamboo', 'Fish', 'Berries', 'Grass'],
    ['Animals', 'm', 'How many hearts does an octopus have?', '3', '1', '2', '8'],
    ['Animals', 'h', 'What is a group of crows called?', 'A murder', 'A flock', 'A parliament', 'A gaggle'],
    ['Science', 'e', 'Which planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Mercury'],
    ['Science', 'e', 'Which gas do plants take in from the air?', 'Carbon dioxide', 'Oxygen', 'Helium', 'Nitrogen'],
    ['Science', 'm', 'What is H2O better known as?', 'Water', 'Salt', 'Hydrogen peroxide', 'Air'],
    ['Science', 'm', 'How many bones are in the adult human body?', '206', '106', '306', '156'],
    ['Science', 'h', 'What is the hardest natural substance?', 'Diamond', 'Gold', 'Iron', 'Quartz'],
    ['Science', 'e', 'What is the closest star to Earth?', 'The Sun', 'Polaris', 'Sirius', 'Alpha Centauri'],
    ['Science', 'm', 'Which planet has the most famous rings?', 'Saturn', 'Uranus', 'Neptune', 'Mars'],
    ['Science', 'h', 'Which part of a cell holds most of its DNA?', 'Nucleus', 'Membrane', 'Ribosome', 'Cytoplasm'],
    ['Geography', 'e', 'What is the largest ocean?', 'Pacific', 'Atlantic', 'Indian', 'Arctic'],
    ['Geography', 'e', 'What is the capital of the United States?', 'Washington, D.C.', 'New York City', 'Los Angeles', 'Chicago'],
    ['Geography', 'm', 'Which continent is Egypt in?', 'Africa', 'Asia', 'Europe', 'South America'],
    ['Geography', 'm', 'Which state is nicknamed the Sunshine State?', 'Florida', 'California', 'Arizona', 'Hawaii'],
    ['Geography', 'h', 'What is the smallest country in the world?', 'Vatican City', 'Monaco', 'San Marino', 'Liechtenstein'],
    ['Geography', 'm', 'How many states are in the USA?', '50', '48', '52', '51'],
    ['Geography', 'h', 'What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
    ['Geography', 'e', 'Which country is shaped like a boot?', 'Italy', 'Spain', 'Greece', 'France'],
    ['History', 'e', 'Who was the first President of the United States?', 'George Washington', 'Abraham Lincoln', 'Thomas Jefferson', 'John Adams'],
    ['History', 'm', 'In what year did people first walk on the Moon?', '1969', '1959', '1975', '1965'],
    ['History', 'm', 'Which ancient people built the pyramids at Giza?', 'Egyptians', 'Romans', 'Greeks', 'Aztecs'],
    ['History', 'h', 'What did the Wright brothers famously build and fly?', 'The first successful airplane', 'The first telephone', 'The first light bulb', 'The first car'],
    ['History', 'h', 'Which ship sank in 1912 after hitting an iceberg?', 'Titanic', 'Lusitania', 'Mayflower', 'Britannic'],
    ['Movies', 'e', 'What kind of animal is Simba in "The Lion King"?', 'Lion', 'Tiger', 'Cheetah', 'Bear'],
    ['Movies', 'e', 'In "Toy Story", what is the cowboy\'s name?', 'Woody', 'Buzz', 'Jessie', 'Rex'],
    ['Movies', 'm', 'What color is Shrek?', 'Green', 'Blue', 'Gray', 'Purple'],
    ['Movies', 'm', 'In "Frozen", who sings "Let It Go"?', 'Elsa', 'Anna', 'Olaf', 'Kristoff'],
    ['Movies', 'h', 'What is the name of the fairy in "Peter Pan"?', 'Tinker Bell', 'Fauna', 'Navi', 'Silvermist'],
    ['Video Games', 'e', 'What is the name of Nintendo\'s famous plumber?', 'Mario', 'Luigi', 'Wario', 'Toad'],
    ['Video Games', 'm', 'In Minecraft, which green mob explodes when it gets close?', 'Creeper', 'Zombie', 'Enderman', 'Skeleton'],
    ['Video Games', 'm', 'What color is Sonic the Hedgehog?', 'Blue', 'Red', 'Green', 'Yellow'],
    ['Video Games', 'h', 'Which princess does Link usually rescue?', 'Zelda', 'Peach', 'Daisy', 'Rosalina'],
    ['Video Games', 'e', 'What does Pac-Man eat as he moves through the maze?', 'Dots', 'Coins', 'Rings', 'Stars'],
    ['Food & Drink', 'e', 'Which fruit is the main ingredient in guacamole?', 'Avocado', 'Lime', 'Tomato', 'Pepper'],
    ['Food & Drink', 'm', 'Which country is pizza originally from?', 'Italy', 'Greece', 'France', 'United States'],
    ['Food & Drink', 'm', 'What is the main ingredient in hummus?', 'Chickpeas', 'Lentils', 'Peanuts', 'Potatoes'],
    ['Food & Drink', 'h', 'Which spice gives most curry powder its yellow color?', 'Turmeric', 'Saffron', 'Paprika', 'Cumin'],
    ['Sports', 'e', 'How many players does a basketball team have on the court?', '5', '6', '7', '4'],
    ['Sports', 'm', 'In which sport do you score a touchdown?', 'Football', 'Soccer', 'Baseball', 'Hockey'],
    ['Sports', 'm', 'How many holes are on a standard golf course?', '18', '9', '12', '24'],
    ['Sports', 'h', 'How often are the Summer Olympics held?', 'Every 4 years', 'Every 2 years', 'Every year', 'Every 5 years'],
    ['Music', 'e', 'How many strings does a standard guitar have?', '6', '4', '5', '8'],
    ['Music', 'm', 'Which instrument usually has 88 keys?', 'Piano', 'Organ', 'Accordion', 'Xylophone'],
    ['Music', 'h', 'Which famous composer kept writing music after going deaf?', 'Beethoven', 'Mozart', 'Bach', 'Chopin'],
    ['General', 'e', 'How many days are in a leap year?', '366', '365', '364', '360'],
    ['General', 'e', 'What color do you get when you mix blue and yellow?', 'Green', 'Purple', 'Orange', 'Brown'],
    ['General', 'm', 'How many sides does a hexagon have?', '6', '5', '7', '8'],
    ['General', 'h', 'How many minutes are in a day?', '1,440', '1,200', '2,400', '1,000'],
    ['General', 'h', 'What does a barometer measure?', 'Air pressure', 'Temperature', 'Wind speed', 'Rainfall'],
    ['TV', 'm', 'Who lives in a pineapple under the sea?', 'SpongeBob', 'Patrick', 'Squidward', 'Sandy'],
    ['TV', 'h', 'In "The Simpsons", what is Homer\'s favorite snack?', 'Donuts', 'Pizza', 'Hot dogs', 'Pretzels'],
    ['Science', 'm', 'What is the name of our galaxy?', 'The Milky Way', 'Andromeda', 'The Big Dipper', 'Orion'],
    ['Science', 'h', 'Which planet is closest to the Sun?', 'Mercury', 'Venus', 'Mars', 'Earth']
  ],
  cheeky: [
    ['Love & Romance', 'e', 'On what date is Valentine\'s Day?', 'February 14', 'February 12', 'March 14', 'January 14'],
    ['Love & Romance', 'm', 'What is the fear of kissing called?', 'Philemaphobia', 'Arachnophobia', 'Gamophobia', 'Agoraphobia'],
    ['Love & Romance', 'e', 'Which Roman god of love shoots arrows?', 'Cupid', 'Mars', 'Bacchus', 'Apollo'],
    ['Love & Romance', 'e', 'Which flower is the classic symbol of romantic love?', 'Red rose', 'White lily', 'Sunflower', 'Tulip'],
    ['Love & Romance', 'm', 'Which wedding anniversary is traditionally the silver one?', '25th', '10th', '50th', '15th'],
    ['Love & Romance', 'h', 'Which wedding anniversary is the golden one?', '50th', '40th', '25th', '60th'],
    ['Love & Romance', 'm', 'Which city is nicknamed the City of Love?', 'Paris', 'Venice', 'Rome', 'Vienna'],
    ['Booze', 'e', 'Which spirit is the base of a margarita?', 'Tequila', 'Vodka', 'Rum', 'Gin'],
    ['Booze', 'm', 'Real Champagne has to come from which country?', 'France', 'Italy', 'Spain', 'Germany'],
    ['Booze', 'e', 'Which fruit is traditionally used to make hard cider?', 'Apples', 'Pears', 'Grapes', 'Cherries'],
    ['Booze', 'm', 'Besides rum, lime and sugar, what herb goes in a mojito?', 'Mint', 'Basil', 'Rosemary', 'Thyme'],
    ['Booze', 'h', 'Bourbon must be made mostly from which grain?', 'Corn', 'Wheat', 'Rye', 'Barley'],
    ['Booze', 'm', 'What does IPA stand for on a beer menu?', 'India Pale Ale', 'Imported Pale Ale', 'Irish Pale Ale', 'Instant Pint Ale'],
    ['Booze', 'e', 'What color is a classic Bloody Mary?', 'Red', 'Green', 'Blue', 'Clear'],
    ['Booze', 'm', 'Vodka, cranberry, lime and triple sec make which cocktail?', 'Cosmopolitan', 'Mojito', 'Mai Tai', 'Manhattan'],
    ['Booze', 'h', 'Gin traces back to genever, from which country?', 'The Netherlands', 'England', 'Ireland', 'Germany'],
    ['Flirty Facts', 'm', 'Which hormone, nicknamed the "cuddle hormone", is released when you hug?', 'Oxytocin', 'Adrenaline', 'Insulin', 'Melatonin'],
    ['Flirty Facts', 'e', 'Which shellfish is famous as an aphrodisiac?', 'Oysters', 'Shrimp', 'Crab', 'Lobster'],
    ['Flirty Facts', 'e', 'At the end of a text, what does an X mean?', 'A kiss', 'A hug', 'A wink', 'A high five'],
    ['Flirty Facts', 'm', 'And what does an O mean?', 'A hug', 'A kiss', 'Surprise', 'Zero'],
    ['Flirty Facts', 'h', 'A passionate kiss can use up to about how many facial muscles?', '34', '5', '12', '80'],
    ['Movies', 'm', 'In "Dirty Dancing", nobody puts Baby where?', 'In a corner', 'On the shelf', 'In the car', 'On the bench'],
    ['Movies', 'h', 'Which 1990 movie has the famous pottery-wheel love scene?', 'Ghost', 'Pretty Woman', 'Dirty Dancing', 'The Bodyguard'],
    ['Movies', 'm', 'Which vampire saga stars Bella and Edward?', 'Twilight', 'True Blood', 'Interview with the Vampire', 'The Vampire Diaries'],
    ['Movies', 'h', 'In "Titanic", Jack draws Rose wearing nothing but what?', 'A necklace', 'A hat', 'A smile', 'Her shoes'],
    ['Music', 'm', 'Who sang "Let\'s Get It On"?', 'Marvin Gaye', 'Barry White', 'Prince', 'Al Green'],
    ['Music', 'm', 'Who sang "I Wanna Dance with Somebody"?', 'Whitney Houston', 'Madonna', 'Cyndi Lauper', 'Janet Jackson'],
    ['Music', 'h', 'Which band sang "Pour Some Sugar on Me"?', 'Def Leppard', 'Bon Jovi', 'Poison', 'Mötley Crüe'],
    ['Music', 'e', 'Who sang "Sexual Healing"?', 'Marvin Gaye', 'Lionel Richie', 'Stevie Wonder', 'Luther Vandross']
  ],
  spicy: [
    ['Sex Facts', 'm', 'The G in "G-spot" comes from what?', 'A doctor named Gräfenberg', 'The word "great"', 'The word "genital"', 'The word "glory"'],
    ['Sex Facts', 'e', 'Which ancient Indian text is famous for its sex positions?', 'Kama Sutra', 'Bhagavad Gita', 'Rig Veda', 'Ramayana'],
    ['Sex Facts', 'm', 'Which great ape is famous for using sex to settle arguments?', 'Bonobo', 'Gorilla', 'Orangutan', 'Gibbon'],
    ['Sex Facts', 'm', 'Which of these animals has a corkscrew-shaped penis?', 'Pig', 'Horse', 'Dog', 'Bull'],
    ['Sex Facts', 'h', 'Studies put the average erect penis at roughly what length?', 'About 5 to 5.5 inches', 'About 7 to 8 inches', 'About 3 inches', 'About 9 inches'],
    ['Sex Facts', 'h', 'Studies put average intercourse, start to finish, at roughly how long?', 'About 5 to 6 minutes', 'About 30 seconds', 'About 20 minutes', 'About an hour'],
    ['Sex Facts', 'm', 'What is the name of the small, sensitive bump at the top of the vulva?', 'Clitoris', 'Cervix', 'Labia', 'Perineum'],
    ['Sex Facts', 'h', 'Roughly how many nerve endings does the clitoris have?', 'About 8,000', 'About 800', 'About 80', 'About 80,000'],
    ['Sex Facts', 'm', 'Which Roman goddess of love gave her name to "venereal" diseases?', 'Venus', 'Juno', 'Diana', 'Minerva'],
    ['Sex Facts', 'e', 'Another name for a love bite is a what?', 'Hickey', 'Smooch', 'Nibble', 'Peck'],
    ['Dirty Minds', 'e', 'Which fruit emoji usually means a butt?', 'Peach', 'Cherry', 'Apple', 'Melon'],
    ['Dirty Minds', 'e', 'And which vegetable emoji means something else entirely?', 'Eggplant', 'Carrot', 'Cucumber', 'Corn'],
    ['Dirty Minds', 'm', 'What does MILF stand for?', 'Mom I\'d Like to Fuck', 'Married In Lingerie Forever', 'Model In Lace Fashion', 'Mother-In-Law Friendly'],
    ['Dirty Minds', 'e', 'What does "Netflix and chill" really mean?', 'Hooking up', 'Watching a movie', 'Taking a nap', 'Ordering pizza'],
    ['Dirty Minds', 'm', 'A "cougar" is slang for what?', 'An older woman dating younger men', 'A sports car', 'A dance move', 'A cocktail'],
    ['Dirty Minds', 'h', 'Which 1700s Venetian wrote memoirs about seducing more than 100 women?', 'Casanova', 'Don Juan', 'Romeo', 'Valentino'],
    ['Dirty Minds', 'm', 'In the "Fifty Shades" books, what is Christian\'s playroom called?', 'The Red Room', 'The Black Room', 'The Dungeon', 'The Velvet Room'],
    ['Booze', 'm', 'About how many 1.5-ounce shots are in a 750 ml bottle?', 'About 17', 'About 5', 'About 30', 'About 10'],
    ['Booze', 'e', 'What does BAC measure?', 'Blood alcohol content', 'Beer and cocktails', 'Bar alcohol count', 'Booze absorption chart'],
    ['Booze', 'e', 'In beer pong, how many cups does each side usually start with?', '10', '6', '12', '8'],
    ['Booze', 'e', 'Which liquor is in a classic Sex on the Beach?', 'Vodka', 'Rum', 'Tequila', 'Gin'],
    ['Booze', 'h', 'Which country drinks the most beer per person?', 'Czech Republic', 'Germany', 'Ireland', 'United States'],
    ['Booze', 'm', 'A Screaming Orgasm has vodka, amaretto, coffee liqueur and what?', 'Irish cream', 'Milk', 'Coconut rum', 'Cola'],
    ['Booze', 'e', 'What is the legal drinking age in the United States?', '21', '18', '19', '20']
  ],
  filthy: [
    ['Sex Facts', 'm', 'What is the "refractory period"?', 'Recovery time after a man finishes', 'How long foreplay lasts', 'A bra size', 'Time until ovulation'],
    ['Sex Facts', 'm', 'What is the area between the genitals and the anus called?', 'Perineum', 'Prostate', 'Pubis', 'Pelvis'],
    ['Sex Facts', 'h', 'How do you reach the prostate, a.k.a. the "P-spot"?', 'Through the rectum', 'Behind the belly button', 'Through the thigh', 'Under the tongue'],
    ['Sex Facts', 'e', 'What does "69" mean in the bedroom?', 'Mutual oral sex', 'A threesome', 'Standing up', 'A safe word'],
    ['Sex Facts', 'm', 'BDSM stands for bondage, discipline, sadism and what?', 'Masochism', 'Massage', 'Mischief', 'Moaning'],
    ['Sex Facts', 'e', 'What is a safe word for?', 'Stopping the action right away', 'Unlocking a phone', 'Ordering a drink', 'Starting foreplay'],
    ['Sex Facts', 'm', 'What is "edging"?', 'Stopping just before climax to make it last', 'Shaving down there', 'Doing it on the edge of a table', 'Foreplay with ice'],
    ['Sex Facts', 'e', 'The "rabbit" is a famous kind of what?', 'Vibrator', 'Position', 'Condom', 'Lingerie'],
    ['Sex Facts', 'e', 'What does DTF stand for?', 'Down to fuck', 'Dinner then flirt', 'Date tonight, Friday', 'Drinks then fun'],
    ['Sex Facts', 'h', 'Which farm animal is famous for orgasms that can last around 30 minutes?', 'Pig', 'Rabbit', 'Goat', 'Horse'],
    ['Sex Facts', 'm', 'A toy worn by one partner to penetrate the other is called a what?', 'Strap-on', 'Cock ring', 'Butt plug', 'Bullet'],
    ['Sex Facts', 'm', 'What does a cock ring help with?', 'Staying harder for longer', 'Holding your keys', 'Preventing pregnancy', 'Measuring size'],
    ['Sex Facts', 'h', 'Studies put the average female orgasm at roughly how long?', 'About 20 seconds', 'About 2 seconds', 'About 5 minutes', 'About an hour'],
    ['Sex Facts', 'm', '"The clap" is slang for which infection?', 'Gonorrhea', 'Herpes', 'The flu', 'Pink eye'],
    ['Sex Facts', 'e', 'A "Brazilian" at the salon removes hair from where?', 'Everywhere down there', 'The legs', 'The eyebrows', 'The armpits'],
    ['Sex Facts', 'e', 'What does "throuple" mean?', 'A three-person relationship', 'A three-day bender', 'A double date', 'A wedding trio'],
    ['Sex Facts', 'e', 'What is the Mile High Club?', 'People who\'ve had sex on a plane', 'A hiking group', 'A frequent flyer program', 'A rooftop bar'],
    ['Sex Facts', 'h', 'Roughly how many calories are in a teaspoon of semen?', 'About 5 to 7', 'About 100', 'About 50', 'Zero'],
    ['Positions', 'e', 'Which position is named after a farm animal?', 'Doggy style', 'Reverse cowgirl', 'Missionary', 'Spooning'],
    ['Positions', 'e', 'In cowgirl, who is on top?', 'The woman', 'The man', 'Nobody', 'Whoever lost the coin toss'],
    ['Positions', 'm', 'Which position is the classic face-to-face, one partner on top?', 'Missionary', 'Doggy style', 'Spooning', 'The wheelbarrow'],
    ['Positions', 'm', 'Both partners lying on their sides, one behind the other, is called what?', 'Spooning', 'Scissoring', 'The pretzel', 'Lotus'],
    ['Dirty Minds', 'm', 'What is a "pearl necklace" in the bedroom?', 'Finishing on someone\'s chest or neck', 'An expensive gift', 'A nipple toy', 'A position'],
    ['Dirty Minds', 'e', 'What is dirty talk?', 'Saying naughty things during sex', 'Gossip', 'Swearing at work', 'Talking with your mouth full'],
    ['Dirty Minds', 'm', 'What does "squirting" refer to?', 'Female ejaculation', 'A water fight', 'A lube bottle', 'Spitting']
  ]
};

// Couples dares: a wrong answer (or the round's loser) has to do one.
const DARES = {
  cheeky: [
    'Give your partner a slow 10-second kiss.',
    'Whisper a compliment in your partner\'s ear.',
    'Give your partner a one-minute shoulder rub.',
    'Kiss your partner somewhere other than the lips.',
    'Tell your partner the first thing you noticed about them.',
    'Slow dance for 30 seconds. No music needed.',
    'Let your partner pick your next drink.',
    'Hold eye contact for 30 seconds without laughing.',
    'Feed your partner a bite of something.',
    'Tell your partner your favorite thing about their body.'
  ],
  spicy: [
    'Take off one item of clothing.',
    'Kiss your partner\'s neck for 10 seconds.',
    'Sit on your partner\'s lap for the next question.',
    'Give your partner a 30-second lap dance.',
    'Let your partner take off one item of your clothing.',
    'Whisper exactly what you want to do later tonight.',
    'Answer the next question in your underwear.',
    'Kiss your partner like it\'s your very first kiss.',
    'Let your partner leave a hickey somewhere hidden.',
    'Describe your partner\'s sexiest feature in detail.'
  ],
  filthy: [
    'Take off two items of clothing.',
    'Let your partner kiss you anywhere they choose for 20 seconds.',
    'Tell your partner your dirtiest fantasy.',
    'Your partner can touch you anywhere for 30 seconds. You can\'t move.',
    'Lick something off your partner. Whipped cream if you\'ve got it.',
    'Show your favorite position. Clothes on… for now.',
    'Play the next round topless.',
    'Do your best orgasm face. Hold it for 5 seconds.',
    'Take one item of your partner\'s clothing off with your teeth.',
    'Whoever loses the game picks the first position tonight.'
  ]
};

// Drinking rules, spiced to the level.
const DRINKS = {
  cheeky: { wrong: 'Wrong! Take a sip 🍷', streak: 'Three in a row! Give out 2 sips 🥂', last: 'Last place finishes their drink 🍾', everyone: 'Everyone drink! Cheers 🥂' },
  spicy: { wrong: 'Wrong, dumbass. Drink up 🍺', streak: 'Hat trick! Make someone else drink 2 🍻', last: 'Dead last: finish that drink 🥃', everyone: 'Everybody drinks, no excuses 🍻' },
  filthy: { wrong: 'Wrong as hell. Drink, you beautiful idiot 🥃', streak: 'Three for three! Pick someone to take 3 🔥', last: 'Loser chugs. And does the last dare 😈', everyone: 'Everyone drink, then kiss someone 💋' }
};

const QUESTIONS = Object.fromEntries(Object.entries(RAW).map(([level, list]) => [level, list.map(([genre, d, question, correct, ...wrong], i) => ({
  id: `b-${level}-${i}`, source: 'builtin', level, genre, difficulty: DIFF[d], question, correct, wrong
}))]));

module.exports = { LEVELS, levelOf, QUESTIONS, DARES, DRINKS };
