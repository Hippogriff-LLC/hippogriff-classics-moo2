# Game rules (project-authored approximations)

The simulation in `src/engine/` follows the overall shape of the classic 4X design: colonies with
farmers, workers and scientists; per-field research topics where one application is chosen; designed
ships; tactical combat; a galactic council. **Every number and formula is project-authored.** None was
extracted from the original executable, and they are not claimed to match the original tables. Where the
original behaviour is well known from play, the intent is to approximate it. Exact parity is out of scope
for Sprint 001.

## Turn structure (`turn.ts`)

1. `endTurn`: AI orders, colony governors, fleet movement, contacts and battle detection. Battles
   between computer players resolve automatically. Battles that involve the human are queued, and the
   game enters the `battles` phase.
2. The UI lets the player fight each queued battle on the tactical grid or auto-resolve it.
3. `finishTurn`: economy, production, research, growth, espionage, diplomacy, random events, the council
   vote, then elimination and victory checks; the turn counter advances.

All randomness flows through a serialisable sfc32 generator stored in the game state. Replaying the same
orders from the same save gives the same results; `tests/integration.test.ts` checks this.

## Galaxy (`galaxy.ts`, `newgame.ts`)

* Galaxies come in small, medium, large and huge, with 20–72 stars placed by rejection sampling under a
  minimum distance.
* Star colour sets planet-count and climate weights. Galaxy age shifts the weights towards mineral
  richness (young) or habitability (old).
* Orion sits near the centre, guarded by a strong monster fleet. Other monsters guard a few rich systems.
* Each empire starts on a homeworld with a frigate pair, two scouts and a colony ship.

## Colonies and economy (`economy.ts`)

* Planet sizes count 1–5 units; climate gives a population factor and base food per farmer. Mineral
  richness gives base industry per worker (1, 2, 3, 5, 8).
* Maximum population = size units × climate factor, adjusted by race traits, buildings and technology.
* Food per farmer = climate base + race bonus + buildings, scaled by the gravity multiplier.
* Industry per worker = minerals + race bonus + buildings, with flat bonuses on top. Morale and
  government scale it.
* Pollution is half of the gross industry above the planet's tolerance (2–10 by size), reduced by
  pollution-processing buildings.
* Research per scientist is 3 + race bonus + buildings.
* Food shortfalls cause starvation. Missing upkeep forces asset sales.
* Morale depends on government, buildings and distance from the capital.
* Population growth is logistic towards the maximum.
* Command points come from starbases and technology. Ships beyond the limit cost BC.

## Production (`production.ts`)

Each colony has a build queue of buildings, ship designs, spies, freighters, housing and trade goods.
Industry carries over between items. Buying the item at the head of the queue costs 2 BC per remaining
production point once work has started, and 4 BC per point before that.

## Research (`research.ts`, `data/techs.ts`)

There are eight fields, each a chain of topics. Completing a topic grants the chosen application. Races
with the creative trait get all applications but pay 10 % more; uncreative races receive one at random. Topic cost grows
with tier and galaxy size. AI players weigh applications by category.

## Ship design (`designs.ts`, `data/ships.ts`)

* Hulls range from frigate to doom star, with space, structure and cost scaling.
* Designs choose a computer, shield, armour, drive, weapon mounts and specials. Space and tech gating are
  validated.
* There are three weapon families with different hit rules: beams, missiles and bombs.
* Automatic design builds a role-based loadout (warship, missile boat, bomber, colony, outpost or troop
  ship) for the AI and for the design screen's helper buttons.

## Tactical combat (`combat.ts`)

* The grid is 18 × 12 and distance is Chebyshev. Battles last at most 20 rounds.
* Units act in initiative order: move up to their speed, then fire every weapon in range at one target.
* **Beams:** hit chance falls with range and target defence and rises with attacker attack. Damage equals
  a weapon roll × beam multiplier, minus shields.
* **Missiles:** about 75 % base, modified by attack and target evasion. Anti-missile systems can stop
  them. Ammunition is limited.
* **Bombs and other weapons:** high base chance; shields count half.
* Damage depletes armour, then structure.
* Defence bases (missile bases, starbases, battlestations and star fortresses) fight for colonies.
* Retreating ships leave the battle. After the battle, retreating fleets and the losing side's
  survivors move to the nearest friendly system. In an undecided battle the attacker pulls back. Monsters
  hold their lair.
* Auto-resolve runs the same AI used for computer-controlled units.

## Ground combat (`ground.ts`)

Invasions pit troop transports against garrisons in rounds of opposed d100 + troop strength duels. Troop
strength depends on race, armour and technology. Bombardment destroys population and buildings in
proportion to the fleet's bomb damage.

## Diplomacy and espionage (`diplomacy.ts`)

* Relations move between war, peace (no treaty), non-aggression pact and alliance. Trade and research
  treaties are separate.
* Each AI keeps an attitude towards every empire. Attitude shifts with treaties, gifts, border pressure,
  relative power and recent wars.
* Proposals are accepted when the attitude plus an evaluation of the proposal clears a threshold.
* Spies are trained in colonies. Each turn, attack strength (spies + race + tech) is compared with the
  defence. A success steals a technology or sabotages a building. Failures can expose and kill spies.

## Events and council (`events.ts`)

* From turn 10, each turn has a 6 % chance of a random event (if enabled at game setup): new mineral
  deposits, plague, an industrial accident, a recovered derelict, a trade windfall or a space monster
  appearing.
* Every 25 turns the two most powerful empires stand for election. Votes are weighted by population.
  Two-thirds of the votes elect a High Master. If the human loses, they may accept or defy the result.

## Victory and defeat

* **Conquest:** the last empire with colonies wins.
* **Council:** an empire is elected and the result stands.
* **Defeat:** the human player's empire has no colonies left (outposts count) and is eliminated.
