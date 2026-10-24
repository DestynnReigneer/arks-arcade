# Your own logos, characters, sounds and clips

The arcade works fine without any of this. But if you run it at home, you can
give it your own personality: your logo at the top, your favorite game
characters on the wall, your own announcer when someone feeds it coins, and
clips you can spring on the family. Everything here lives in two folders on
your server, next to the compose file. None of it is part of the arcade's code,
so it never ends up on GitHub, and an update never overwrites it.

```
arcade/                  the folder with your docker-compose.yml
├── docker-compose.yml
├── .env
├── data/                the arcade's database (already there)
├── brand/               your logos
└── media/
    ├── sprites/         characters for the home page
    ├── coin/            announcer sounds for INSERT COIN
    └── clips/           GIFs, videos and sounds for surprises and pranks
```

The compose file already connects both folders to the arcade, read-only, so the
arcade can show these files but never change them. Create whichever folders you
want; any you leave out are simply skipped. After you add or remove files, the
arcade notices within a minute. You don't need to restart it.

File names must be plain: letters, numbers, dashes and underscores, then the
extension, like `rick-roll.mp4`. A name with spaces or other symbols is
skipped, so the arcade can never be tricked into showing a file from somewhere
else.

## brand/: your logo in the header and footer

Put three files here, with exactly these names:

| File | Where it shows |
|---|---|
| `avatar.svg` | A small round picture at the start of the title |
| `logo-wide.svg` | Your wide logo, between the picture and the word ARCADE |
| `logo-square.svg` | Your square logo, spinning slowly at the bottom of the home page |

With `avatar.svg` and `logo-wide.svg`, the plain "ARCADE" title becomes your
picture, your logo and "ARCADE" drawn as an outline. With `logo-square.svg`,
the footer gets your logo. Use SVG files with no background, so they look sharp
at any size and sit nicely on the dark page.

## media/sprites/: characters on the home page

The home page has little characters on the walls beside the games (on a phone,
they sit inside the Cheat codes box instead). Tap one and it hops and runs a
command, like making the page dance. The arcade comes with four of its own
pixel characters. If you put pictures here, yours take their place.

- **What:** PNG, GIF (animated is fine), WebP, SVG or JPG.
- **Size:** each file 2 MB or less. They're shown about 52 pixels tall, so a
  square-ish picture with a see-through background looks best. Anything from
  64×64 to 256×256 pixels is plenty.
- **How many:** up to six are shown. If you add more, the first six in
  alphabetical order are used.
- **Which command:** you don't need to name them anything special; each one gets a
  command on its own. To tie a picture to a command, start its name with the
  command, like `dance-hero.gif` (it always runs /dance) or `roll-wizard.png`.

## media/coin/: the INSERT COIN announcer

Tapping INSERT COIN under the title drops a coin in. The third coin in a row
gets an announcer. Without files here, the browser's own voice says something
like "Choose your fighter!". With files here, one of them plays at random
instead.

- **What:** MP3, OGG, WAV or M4A.
- **Size:** each file 2 MB or less. Keep them short, a few seconds at most.

## media/clips/: surprises and pranks

Clips are GIFs, short videos and sounds. Each one can show up in three ways:

1. **As a secret command.** Every clip becomes a command named after its file:
   `rickroll.mp4` plays when someone types `/rickroll` in the Cheat codes box.
2. **Sent by the admin.** In Admin, the Arcade tab has a **Send a clip**
   section. Pick a clip and a person (or everyone), and it pops up the next time
   their screen is open anywhere in the arcade. Clips only go to profiles, not
   guests, and one that hasn't been seen yet is forgotten if the server
   restarts.
3. **As a random surprise.** Now and then, a page load plays a random clip. It's
   one page load in 200 unless you change `CLIP_SURPRISE` in `.env`; set it to 0
   to turn surprises off.

Browsers don't allow a page to play sound until someone taps it, so every clip
first appears behind a card like "You have a new message! Tap to open". That
also makes it a better prank.

- **What:** GIF, PNG, JPG or WebP pictures; MP4 or WebM video; MP3, OGG, WAV
  or M4A sound. For MP4, use the common H.264 format so every browser and
  phone can play it.
- **Size:** each file 50 MB or less. Short is better: under a minute.

## A note on other people's characters and music

The arcade only shows these files; it doesn't come with any. If you use
characters, voices or music from games and movies you didn't make, keep them on
your own home server for your family, and don't publish them anywhere.
