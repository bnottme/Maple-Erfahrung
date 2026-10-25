/**
 * Map database (MapleStory Classic - Maple Island / Victoria Island region).
 * Pure data, no I/O, so it bundles with the static site.
 *
 * Source: meowdb.com map list. The site's trailing "EXP/HR" column is
 * intentionally dropped (it's a derived estimate); keep the raw inputs so the
 * app can compute its own rates if needed.
 *
 * Rows are stored as a compact pipe-delimited table and parsed once at module
 * load - far smaller in source than ~350 object literals.
 *
 * Columns: name | kind | street | region | mobs | types | avgLevel | mobRate | expPerKill
 *   kind      - "map" (huntable), "town" (safe zone / shop), or "pq" (party quest stage)
 *   mobs      - spawn count on the map
 *   types     - number of distinct monster types
 *   avgLevel  - average monster level
 *   mobRate   - spawn-rate multiplier (the site's "Nx" value)
 *   expPerKill- average EXP per kill
 * A blank numeric field means "not applicable / no combat data" (null).
 */

export type MapKind = "map" | "town" | "pq";

export interface MapInfo {
  name: string;
  kind: MapKind;
  street: string;
  region: string;
  mobs: number | null;
  types: number | null;
  avgLevel: number | null;
  mobRate: number | null;
  expPerKill: number | null;
}

// name|kind|street|region|mobs|types|avgLevel|mobRate|expPerKill
const RAW = `
1st Accompaniment <1st Stage>|pq|Hidden Street|Hidden Street|22|1|21.0|0.9|68
1st Accompaniment <2nd Stage>|pq|Hidden Street|Hidden Street||||| 
1st Accompaniment <3rd Stage>|pq|Hidden Street|Hidden Street||||| 
1st Accompaniment <4th stage>|pq|Hidden Street|Hidden Street||||| 
1st Accompaniment <Bonus>|pq|Hidden Street|Hidden Street|36|2|19.3|1.5|36
1st Accompaniment <Exit>|pq|Hidden Street|Hidden Street||||| 
1st Accompaniment <Last Stage>|pq|Hidden Street|Hidden Street|10|3|26.9|1.0|84.3
3-Way Road-Split|map|Victoria Road|Victoria Island|68|7|5.2|1.0|10.1
A Hill West of Henesys|map|Victoria Road|Victoria Island|54|6|6.5|0.9|12.5
A Look-Out Shed Around the Beach|map|Florina Road|Victoria Island|63|2|37.6|1.0|77.6
A Split Road|map|Maple Road|Maple Island|42|3|2.9|1.0|5.7
Amherst|town|Rainbow Street|Maple Island||||| 
Amherst Department Store|town|Rainbow Street|Maple Island||||| 
Amherst Townstreet|town|Rainbow Street|Maple Island||||| 
Amherst Weapon Store|town|Rainbow Street|Maple Island||||| 
An Empty House|map|Hidden Street|Victoria Island|6|1|8.0|1.0|15
Another Entrance|map|Dungeon|Victoria Island||||| 
Another Path|map|Dungeon|Victoria Island|23|1|40.0|0.8|85
Another Sanctuary|map|Deep Passage|Victoria Island|20|3|55.0|1.3|175.8
Ant Tunnel For Bowman|map|Hidden Street|Hidden Street|30|2|30.0|0.7|56
Ant Tunnel I|map|Dungeon|Victoria Island|26|2|22.8|0.6|42.7
Ant Tunnel II|map|Dungeon|Victoria Island|47|2|23.4|0.8|43.7
Ant Tunnel III|map|Dungeon|Victoria Island|99|2|23.2|0.6|43.5
Ant Tunnel IV|map|Dungeon|Victoria Island|64|2|22.7|0.6|42.4
Ant Tunnel Park|map|Dungeon|Victoria Island|58|3|25.5|0.8|47.4
B1 <Area 1>|map|Line 3 Construction Site|Victoria Island|3|1|200.0|1.0|
B1 <Area 2>|map|Line 3 Construction Site|Victoria Island|12|1|200.0|1.0|
B1 <Subway Depot>|map|Line 3 Construction Site|Victoria Island|9|1|15.0|0.5|28
B2 <Area 1>|map|Line 3 Construction Site|Victoria Island||||| 
B2 <Area 2>|town|Line 3 Construction Site|Victoria Island||||| 
B2 <Subway Depot>|map|Line 3 Construction Site|Victoria Island|13|2|34.1|0.5|66
B3 <Area 1>|map|Line 3 Construction Site|Victoria Island|4|1|200.0|1.0|
B3 <Area 2>|map|Line 3 Construction Site|Victoria Island||||| 
B3 <Area 3>|map|Line 3 Construction Site|Victoria Island||||| 
B3 <Subway Depot>|map|Line 3 Construction Site|Victoria Island|12|3|45.8|0.5|121.7
Back to Town|map|Hidden Street|Hidden Street||||| 
Backalley Semi-Basement|town|Victoria Road|Victoria Island||||| 
Backalley Semi-Basement|town|Victoria Road|Hidden Street||||| 
Beach Hunting Ground|map|Hidden Street|Victoria Island|34|8|4.8|1.0|9.3
Before Takeoff <To Orbis>|town|Victoria Road|Victoria Island||||| 
Bowman Instructional School|town|Victoria Road|Victoria Island||||| 
Bygone Days|town|Deep Passage|Victoria Island||||| 
Cabin of the Forsaken|map|Hidden Street|Victoria Island|1|1|48.0|1.0|487
Camp 1|map|Victoria Road|Victoria Island|25|2|58.2|1.0|194.9
Camp 2|map|Victoria Road|Victoria Island|20|2|59.4|1.1|206.3
Camp 3|map|Victoria Road|Victoria Island|20|2|61.2|1.1|224.3
Caution Falling Down|map|Hidden Street|Victoria Island|20|3|12.1|1.9|22.8
Cave Fairy Department Store|town|Shallow Passage|Victoria Island||||| 
Cave Fairy Sanctuary|town|Shallow Passage|Victoria Island||||| 
Clang and Lorang|map|Florina Road|Victoria Island|31|3|45.6|1.3|111.3
Coconut Harvest|map|Hidden Street|Event||||| 
Coconut Harvest|map|Hidden Street|Event||||| 
Coconut Harvest|map|Hidden Street|Event||||| 
Collision of Ice and Fire|map|Hidden Street|Victoria Island|33|3|42.5|0.6|96.7
Construction Site North of Kerning City|map|Victoria Road|Victoria Island|54|6|8.0|1.0|15.4
Damp Forest|map|Dungeon|Victoria Island|28|3|15.1|0.8|28.5
Damp Tree-Forest|map|Dungeon|Victoria Island|46|4|13.3|0.8|25.3
Dangerous Croko I|map|Warning Street|Victoria Island|54|4|25.1|1.0|52.3
Dangerous Croko II|map|Warning Street|Victoria Island|54|3|32.3|1.0|82.1
Dangerous Forest|map|Rainbow Street|Maple Island|34|4|4.0|1.0|7.6
Dangerous Steam|map|Dungeon|Victoria Island|49|3|20.7|0.7|38.4
Dangerous Valley|map|Hidden Street|Victoria Island|34|2|37.0|1.0|78
Dangerous Valley II|map|Hidden Street|Victoria Island|30|3|50.0|1.0|110.4
Dark Cave|map|Dungeon|Victoria Island|51|3|20.9|1.2|38.8
Decayed Tunnel I|map|Deep Passage|Victoria Island|20|2|39.6|1.0|95.6
Decayed Tunnel II|map|Deep Passage|Victoria Island|22|3|44.2|1.5|103.7
Decayed Tunnel III|map|Deep Passage|Victoria Island|15|3|49.1|0.6|131
Deep Ant Tunnel I|map|Dungeon|Victoria Island|68|4|24.8|0.6|45.7
Deep Ant Tunnel II|map|Dungeon|Victoria Island|34|3|24.9|0.6|46.3
Deep Forest|map|Dungeon|Victoria Island|43|7|9.7|0.8|18.5
Deep Valley I|map|Warning Street|Victoria Island|40|7|14.6|0.9|27.4
Deep Valley II|map|Warning Street|Victoria Island|31|5|20.7|1.0|38.8
Deep Valley III|map|Warning Street|Victoria Island|49|5|21.0|0.9|39.4
Dilapidated Tomb|map|Deep Passage|Victoria Island|20|3|52.4|1.1|166.4
Downstairs at the Forest|map|Hidden Street|Victoria Island|39|4|17.8|1.0|30.5
Drake Hunting Ground|map|Dungeon|Victoria Island|22|3|46.1|1.1|123.6
Drake's Meal Table|map|Dungeon|Victoria Island|56|4|47.3|0.6|110.3
Dungeon, Southern Forest I|map|Victoria Road|Victoria Island|21|1|6.0|0.9|12
Dungeon, Southern Forest II|map|Victoria Road|Victoria Island|27|2|10.7|0.9|20.3
Dungeon, Southern Forest III|map|Victoria Road|Victoria Island|26|2|10.9|0.9|20.6
Dungeon, Southern Forest IV|map|Victoria Road|Victoria Island|25|4|17.7|0.9|33
East Domain of Perion|map|Victoria Road|Victoria Island|71|8|10.4|1.0|19.6
East Entrance to Mushroom Town|map|Maple Road|Maple Island|6|1|1.0|0.7|1
East Rocky Mountain I|map|Victoria Road|Victoria Island|52|4|5.7|0.9|11.1
East Rocky Mountain II|map|Victoria Road|Victoria Island|37|3|8.6|1.0|16.6
East Rocky Mountain III|map|Victoria Road|Victoria Island|42|4|10.2|1.0|19.6
East Rocky Mountain IV|map|Victoria Road|Victoria Island|57|4|14.5|0.9|27.4
East Rocky Mountain V|map|Victoria Road|Victoria Island|51|4|17.8|1.2|33.6
East Rocky Mountain VI|map|Victoria Road|Victoria Island|37|5|24.8|1.6|46.9
East Rocky Mountain VII|map|Victoria Road|Victoria Island|57|3|34.6|0.8|73.7
Ellinia|town|Victoria Road|Victoria Island||||| 
Ellinia Department Store|town|Victoria Road|Victoria Island||||| 
Ellinia Station|town|Victoria Road|Victoria Island||||| 
Ellinia Weapon Store|town|Victoria Road|Victoria Island||||| 
Excavation Site <Camp>|map|Victoria Road|Victoria Island||||| 
Excavation Site I|map|Victoria Road|Victoria Island|33|2|20.2|1.2|37.4
Excavation Site II|map|Victoria Road|Victoria Island|53|3|22.4|0.8|41.8
Excavation Site III|map|Victoria Road|Victoria Island|25|2|23.7|1.2|44.4
Florina Beach|town|Florina Road|Victoria Island||||| 
Forbidden Entrance|map|Shallow Passage|Victoria Island|32|4|44.8|0.7|111.7
Forest West of Henesys|map|Victoria Road|Victoria Island|65|8|3.6|0.9|7
Forgotten Dungeon Tunnel|map|Shallow Passage|Victoria Island|28|3|38.6|0.7|80.6
Forgotten Entrance I|map|Shallow Passage|Victoria Island|23|3|41.3|0.5|90.8
Forgotten Entrance II|map|Shallow Passage|Victoria Island|35|3|38.9|0.7|81.6
Forgotten Entrance III|map|Shallow Passage|Victoria Island|44|3|37.8|0.7|78.2
Forgotten Hollow|town|Shallow Passage|Victoria Island||||| 
Free Market <10>|town|Hidden Street|Hidden Street||||| 
Free Market <11>|town|Hidden Street|Hidden Street||||| 
Free Market <12>|town|Hidden Street|Hidden Street||||| 
Free Market <13>|town|Hidden Street|Hidden Street||||| 
Free Market <14>|town|Hidden Street|Hidden Street||||| 
Free Market <15>|town|Hidden Street|Hidden Street||||| 
Free Market <16>|town|Hidden Street|Hidden Street||||| 
Free Market <17>|town|Hidden Street|Hidden Street||||| 
Free Market <18>|town|Hidden Street|Hidden Street||||| 
Free Market <19>|town|Hidden Street|Hidden Street||||| 
Free Market <1>|town|Hidden Street|Hidden Street||||| 
Free Market <20>|town|Hidden Street|Hidden Street||||| 
Free Market <2>|town|Hidden Street|Hidden Street||||| 
Free Market <3>|town|Hidden Street|Hidden Street||||| 
Free Market <4>|town|Hidden Street|Hidden Street||||| 
Free Market <5>|town|Hidden Street|Hidden Street||||| 
Free Market <6>|town|Hidden Street|Hidden Street||||| 
Free Market <7>|town|Hidden Street|Hidden Street||||| 
Free Market <8>|town|Hidden Street|Hidden Street||||| 
Free Market <9>|town|Hidden Street|Hidden Street||||| 
Free Market Entrance|town|Hidden Street|Hidden Street||||| 
G* Coconut Season|map|Hidden Street|Event||||| 
Golem's Temple I|map|Victoria Road|Victoria Island|20|4|38.9|1.3|112.4
Golem's Temple II|map|Victoria Road|Victoria Island|15|4|40.5|1.4|121.7
Golem's Temple III|map|Victoria Road|Victoria Island|23|4|41.0|1.3|124.4
Golem's Temple IV|map|Victoria Road|Victoria Island|16|3|38.1|1.5|109.5
Henesys|town|Victoria Road|Victoria Island||||| 
Henesys Department Store|town|Victoria Road|Victoria Island||||| 
Henesys Dungeon Entrance|map|Warning Street|Victoria Island|38|6|18.6|1.0|41
Henesys Hair Salon|town|Victoria Road|Victoria Island||||| 
Henesys Hunting Ground I|map|Victoria Road|Victoria Island|39|7|5.7|1.5|11
Henesys Hunting Ground II|map|Victoria Road|Victoria Island|47|7|5.9|1.5|11.4
Henesys Hunting Ground III|map|Victoria Road|Victoria Island|59|6|7.6|1.5|14.6
Henesys Market|town|Victoria Road|Victoria Island||||| 
Henesys Park|town|Victoria Road|Victoria Island||||| 
Henesys Plastic Surgery|town|Victoria Road|Victoria Island||||| 
Henesys Skin-Care|town|Victoria Road|Victoria Island||||| 
Henesys Town Hall|town|Victoria Road|Victoria Island||||| 
Henesys Townstreet|town|Victoria Road|Victoria Island||||| 
Henesys Weapon Store|town|Victoria Road|Victoria Island||||| 
Hot Sand|map|Florina Road|Victoria Island|38|2|47.0|1.0|116.5
Hunting Ground in the Deep Forest I|map|Dungeon|Victoria Island|36|7|20.3|0.8|37.7
Hunting Ground in the Deep Forest II|map|Dungeon|Victoria Island|54|5|29.3|0.8|56.8
Hunting Ground Middle of the Forest I|map|Rainbow Street|Maple Island|44|4|2.3|1.0|4.5
Hunting Ground Middle of the Forest II|map|Rainbow Street|Maple Island|45|5|3.0|1.0|5.9
In a Small Forest|map|Rainbow Street|Maple Island|40|5|2.9|1.1|5.6
Kerning City|town|Victoria Road|Victoria Island||||| 
Kerning City Civic Center|town|Victoria Road|Victoria Island||||| 
Kerning City Construction Site|map|Victoria Road|Victoria Island|52|5|6.7|0.7|13
Kerning City Hair Salon|town|Victoria Road|Victoria Island||||| 
Kerning City Middle Forest I|map|Victoria Road|Victoria Island|53|7|5.1|1.0|10
Kerning City Middle Forest II|map|Victoria Road|Victoria Island|47|8|5.9|1.2|11.3
Kerning City Middle Forest III|map|Victoria Road|Victoria Island|50|8|5.7|1.2|11
Kerning City Pharmacy|town|Victoria Road|Victoria Island||||| 
Kerning City Repair Shop|town|Victoria Road|Victoria Island||||| 
Kerning City Self-Defence Item Store|town|Victoria Road|Victoria Island||||| 
L Forest I|map|Victoria Road|Victoria Island|73|10|7.1|1.0|13
L Forest II|map|Victoria Road|Victoria Island|54|12|7.7|1.2|13.7
L Forest III|map|Victoria Road|Victoria Island|83|10|6.9|1.0|12.8
Land of Wild Boar|map|Hidden Street|Victoria Island|35|4|26.3|1.0|45.4
Leaving the Event|map|Hidden Street|Event||||| 
Line 1 <Area 1>|map|Kerning City Subway|Victoria Island|64|1|15.0|0.8|28
Line 1 <Area 2>|map|Kerning City Subway|Victoria Island|90|2|30.7|0.9|59.2
Line 1 <Area 3>|map|Kerning City Subway|Victoria Island|97|3|38.3|0.9|88.3
Line 1 <Area 4>|map|Kerning City Subway|Victoria Island|59|1|48.0|0.9|122
Line 2 <Area 1>|map|Kerning City Subway|Victoria Island|97|2|32.1|0.9|62.1
Line 2 <Area 2>|map|Kerning City Subway|Victoria Island|107|3|39.3|0.9|91.3
Line 2 <Area 3>|map|Kerning City Subway|Victoria Island|68|1|48.0|0.9|122
Lingering Regret|map|Deep Passage|Victoria Island|19|3|46.7|0.6|123.7
Lith Harbor|town|Victoria Road|Victoria Island||||| 
Lith Harbor Armor Shop|town|Victoria Road|Victoria Island||||| 
Lith Harbor Department Store|town|Victoria Road|Victoria Island||||| 
Lith Harbor Weapon Shop|town|Victoria Road|Victoria Island||||| 
Lorang and Clang|map|Florina Road|Victoria Island|47|2|44.8|0.9|108.2
Lorang Lorang|map|Florina Road|Victoria Island|40|2|37.9|0.7|77.6
Lorang Lorang Lorang|map|Hidden Street|Victoria Island|23|2|40.1|1.0|86.6
Magic Library|town|Victoria Road|Victoria Island||||| 
Magician's Tree Dungeon|map|Hidden Street|Hidden Street|26|2|30.0|0.7|56
Maple Hill|town|Hidden Street|Event||||| 
Marr's Forest|town|Hidden Street|Victoria Island||||| 
Monkey Forest I|map|Hidden Street|Victoria Island|23|2|28.0|0.9|55.8
Monkey Forest II|map|Victoria Road|Victoria Island|35|2|39.9|0.8|85
Monkey Swamp I|map|Hidden Street|Victoria Island|31|2|35.5|1.0|71.5
Monkey Swamp II|map|Hidden Street|Victoria Island|26|3|37.2|1.0|77.9
Monkey Swamp III|map|Hidden Street|Victoria Island|42|2|35.8|1.0|75.9
Mushroom Garden|map|Rainbow Street|Maple Island|35|3|3.3|1.0|6.5
Mushroom Garden|map|Hidden Street|Victoria Island|34|3|5.5|1.3|10.5
Mushroom Town|town|Maple Road|Maple Island||||| 
Mushroom Town|town|Maple Road|Maple Island||||| 
Mushroom Town - West Entrance|town|Maple Road|Maple Island||||| 
Mushroom Town Townstreet|town|Maple Road|Maple Island||||| 
Niora Hospital|town|Victoria Road|Victoria Island||||| 
Northern Top of Construction Site|map|Hidden Street|Victoria Island|21|3|11.9|1.8|22.4
Over the Wall|map|Hidden Street|Victoria Island|24|4|15.3|1.5|28.8
Parched Land|map|Victoria Road|Victoria Island|10|5|23.6|1.0|42.7
Perilous Descent I|map|Deep Passage|Victoria Island|18|2|36.8|0.6|82.9
Perilous Descent II|map|Deep Passage|Victoria Island|27|3|43.1|0.7|106.1
Perilous Descent III|map|Deep Passage|Victoria Island|14|2|48.2|0.8|123.7
Perion|town|Victoria Road|Victoria Island||||| 
Perion Department Store|town|Victoria Road|Victoria Island||||| 
Perion Dungeon Entrance|map|Warning Street|Victoria Island|45|4|22.6|0.8|42.2
Perion Street Corner|map|Victoria Road|Victoria Island|40|5|5.8|1.0|11.3
Perion Weapon Store|town|Victoria Road|Victoria Island||||| 
Pet-Walking Road|town|Victoria Road|Victoria Island||||| 
Physical Fitness Test <Easy Level 1>|town|Hidden Street|Event||||| 
Physical Fitness Test <Easy Level 2>|town|Hidden Street|Event||||| 
Physical Fitness Test <Easy Level 3>|town|Hidden Street|Event||||| 
Physical Fitness Test <Easy Waiting Room>|town|Hidden Street|Event||||| 
Physical Fitness Test <Level 1>|map|Hidden Street|Event|14|1|200.0|1.0|
Physical Fitness Test <Level 2>|town|Hidden Street|Event||||| 
Physical Fitness Test <Level 3>|town|Hidden Street|Event||||| 
Physical Fitness Test <Level 4>|map|Hidden Street|Event|14|1|200.0|1.0|
Physical Fitness Test <Normal Level 1>|town|Hidden Street|Event||||| 
Physical Fitness Test <Normal Level 2>|town|Hidden Street|Event||||| 
Physical Fitness Test <Normal Level 3>|town|Hidden Street|Event||||| 
Physical Fitness Test <Normal Waiting Room>|town|Hidden Street|Event||||| 
Physical Fitness Test <Waiting Room>|town|Hidden Street|Event||||| 
Pig Park|map|Hidden Street|Victoria Island|20|1|28.0|0.7|52
Pig Park II|map|Hidden Street|Victoria Island|22|1|28.0|0.7|52
Pig Town|map|Hidden Street|Hidden Street||||| 
Precipice of Darkness|map|Deep Passage|Victoria Island|27|4|48.2|0.6|130.3
Primeval Forest I|map|Shallow Passage|Victoria Island|20|3|42.6|0.6|96.7
Primeval Forest II|map|Shallow Passage|Victoria Island|19|3|43.8|1.1|101.7
Primeval Forest III|map|Shallow Passage|Victoria Island|11|2|41.6|0.7|92.1
Primrose Hill|map|Hidden Street|Hidden Street||||| 
Receiving the Reward For the Event|map|Hidden Street|Event||||| 
Regular Sauna|map|Dungeon|Victoria Island||||| 
Remains <Cliff>|map|Victoria Road|Victoria Island|17|2|71.2|0.6|363.9
Remains <Tomb> I|map|Victoria Road|Victoria Island|23|2|44.9|1.1|106.6
Remains <Tomb> II|map|Victoria Road|Victoria Island|25|3|46.2|1.1|114.5
Remains <Tomb> III|map|Victoria Road|Victoria Island|21|3|47.4|1.4|120.4
Remains <Tomb> IV|map|Victoria Road|Victoria Island|14|2|66.6|0.7|294.9
Right Around Lith Harbor|map|Victoria Road|Victoria Island|43|3|3.6|1.0|7.2
Rocky Road I|map|Victoria Road|Victoria Island|44|5|5.6|1.0|10.8
Rocky Road II|map|Victoria Road|Victoria Island|41|7|10.1|1.0|19
Rocky Road III|map|Victoria Road|Victoria Island|31|5|16.8|1.0|31.5
Sanctuary Entrance I|map|Dungeon|Victoria Island|17|2|47.1|0.8|91.2
Sanctuary Entrance II|map|Dungeon|Victoria Island|19|2|46.3|0.8|94
Sanctuary Entrance III|map|Dungeon|Victoria Island|14|3|54.3|0.8|146.2
Sanctuary Entrance IV|map|Dungeon|Victoria Island|12|3|59.6|0.8|177.4
Shortcut|map|Hidden Street|Hidden Street||||| 
Shortcut|map|Hidden Street|Hidden Street||||| 
Sleepy Dungeon I|map|Dungeon|Victoria Island|25|7|19.4|0.7|36.9
Sleepy Dungeon II|map|Dungeon|Victoria Island|49|7|21.5|0.6|41.5
Sleepy Dungeon III|map|Dungeon|Victoria Island|45|5|38.0|0.5|90.5
Sleepy Dungeon IV|map|Dungeon|Victoria Island|30|5|38.0|0.7|97.4
Sleepy Dungeon V|map|Dungeon|Victoria Island|88|7|37.2|0.4|92.5
Sleepywood|town|Dungeon|Victoria Island||||| 
Sleepywood Hotel|map|Dungeon|Victoria Island||||| 
Snail Field of Flowers|map|Rainbow Street|Maple Island|34|4|3.6|1.2|7
Snail Garden|map|Rainbow Street|Maple Island|41|3|2.3|1.0|4.5
Snail Hunting Ground I|map|Maple Road|Maple Island|40|1|1.0|1.0|2
Snail Hunting Ground II|map|Maple Road|Maple Island|42|2|1.3|1.0|2.6
Snail Hunting Ground III|map|Maple Road|Maple Island|42|3|1.6|1.0|3.1
Someone Else's Grave|map|Hidden Street|Victoria Island|8|4|45.1|1.0|125.4
Someone Else's House|map|Hidden Street|Victoria Island|16|3|28.9|1.3|52.1
Southperry|town|Maple Road|Maple Island||||| 
Southperry Armor Store|town|Maple Road|Maple Island||||| 
Subway Ticketing Booth|map|Victoria Road|Victoria Island||||| 
Sunset Sky|map|Victoria Road|Victoria Island|44|5|7.5|0.6|14.3
Swampy Land in a Deep Forest|map|Dungeon|Victoria Island|50|6|13.0|1.0|24.5
The Blue Mushroom Forest|map|Hidden Street|Victoria Island|32|4|11.6|1.0|21.6
The Breathing Rock|map|Hidden Street|Victoria Island|24|4|30.5|0.9|57.3
The Burnt Land I|map|Warning Street|Victoria Island|25|2|29.5|0.8|55.2
The Burnt Land II|map|Warning Street|Victoria Island|31|2|28.5|0.8|53.4
The Burnt Land III|map|Warning Street|Victoria Island|37|2|28.8|0.9|54
The Burnt Land IV|map|Warning Street|Victoria Island|45|3|31.6|0.9|60.9
The Burnt Land V|map|Warning Street|Victoria Island|48|3|31.4|0.9|60.2
The Cave of Evil Eye I|map|Dungeon|Victoria Island|21|2|27.8|1.1|50.1
The Cave of Evil Eye II|map|Dungeon|Victoria Island|38|2|27.4|1.1|50
The Cave of Evil Eye III|map|Dungeon|Victoria Island|40|2|27.4|1.1|50
The Cave of Evil Eye IV|map|Dungeon|Victoria Island|25|2|27.6|1.1|50
The Circulation Desk|town|Hidden Street|Victoria Island||||| 
The Cursed Sanctuary|map|Dungeon|Victoria Island|1|1|80.0|0.8|
The Deep Forest of Patience <Step 1>|town|Hidden Street|Victoria Island||||| 
The Deep Forest of Patience <Step 2>|town|Hidden Street|Victoria Island||||| 
The Deep Forest of Patience <Step 3>|town|Hidden Street|Victoria Island||||| 
The Deep Forest of Patience <Step 4>|town|Hidden Street|Victoria Island||||| 
The Deep Forest of Patience <Step 5>|map|Hidden Street|Victoria Island|16|2|200.0|1.0|
The Deep Forest of Patience <Step 6>|town|Hidden Street|Victoria Island||||| 
The Deep Forest of Patience <Step 7>|town|Hidden Street|Victoria Island||||| 
The End of Fleeting Light|map|Shallow Passage|Victoria Island|27|3|46.4|0.6|114.8
The Entrance of Golem's Temple|map|Victoria Road|Victoria Island|24|3|34.1|1.5|94.8
The Faded Canopy|map|Shallow Passage|Victoria Island|25|3|41.0|0.6|90
The Field East of Amherst|map|Rainbow Street|Maple Island|38|4|4.4|1.0|8.6
The Field South of Ellinia|map|Victoria Road|Victoria Island|66|4|7.5|1.0|14.7
The Field Up North of Ellinia|map|Victoria Road|Victoria Island|38|3|4.4|1.0|8.7
The Field West of Amherst|map|Rainbow Street|Maple Island|66|5|3.3|0.9|6.6
The Forest East of Henesys|map|Victoria Road|Victoria Island|59|9|6.5|0.6|12.4
The Forest North of Ellinia|map|Victoria Road|Victoria Island|69|4|7.1|1.0|13.9
The Forest of Evil I|map|Hidden Street|Victoria Island|26|2|49.1|0.9|102.8
The Forest of Evil II|map|Hidden Street|Victoria Island|39|2|49.3|1.0|119.7
The Forest of Patience <Step 1>|town|Hidden Street|Victoria Island||||| 
The Forest of Patience <Step 2>|town|Hidden Street|Victoria Island||||| 
The Forest of Patience <Step 3>|town|Hidden Street|Victoria Island||||| 
The Forest of Patience <Step 4>|map|Hidden Street|Victoria Island|18|1|200.0|1.6|
The Forest of Patience <Step 5>|town|Hidden Street|Victoria Island||||| 
The Forest of Wisdom|map|Victoria Road|Victoria Island|58|3|9.9|0.8|18.7
The Forest South of Ellinia|map|Victoria Road|Victoria Island|63|5|5.2|0.7|10.3
The Grave of Mushmom|map|Dungeon|Victoria Island|16|3|27.3|1.0|48.3
The Hermit's Cabin|map|Hidden Street|Victoria Island||||| 
The Hill East of Henesys|map|Victoria Road|Victoria Island|49|7|4.3|1.2|8.5
The Land of Wild Boar II|map|Hidden Street|Victoria Island|33|4|22.6|1.0|41.8
The Murky Swamp I|map|Hidden Street|Victoria Island|33|2|26.2|1.0|48.8
The Murky Swamp II|map|Hidden Street|Victoria Island|26|2|26.4|1.0|49.2
The Pig Beach|map|Hidden Street|Victoria Island|23|5|8.0|1.0|13.5
The Rain-Forest East of Henesys|map|Victoria Road|Victoria Island|9|2|8.3|1.0|15.7
The Resting Spot, Pig Park|map|Hidden Street|Victoria Island||||| 
The Road to the Dungeon|map|Warning Street|Victoria Island|46|9|9.7|1.0|18.3
The Swamp of Despair I|map|Warning Street|Victoria Island|63|4|25.4|1.0|47.6
The Swamp of Despair II|map|Warning Street|Victoria Island|79|4|24.7|1.0|46.1
The Swamp of Despair III|map|Warning Street|Victoria Island|54|3|24.2|1.0|45.4
The Tree That Grew I|map|Victoria Road|Victoria Island|40|3|7.0|1.0|13.9
The Tree That Grew II|map|Victoria Road|Victoria Island|70|3|6.5|1.0|12.7
The Tree That Grew III|map|Victoria Road|Victoria Island|48|3|8.1|1.0|15.6
The Tree Tunnel At the Forest Up North|map|Victoria Road|Victoria Island||||| 
The Tunnel That Lost Light I|map|Dungeon|Victoria Island|52|2|43.8|0.8|103.5
The Tunnel That Lost Light II|map|Dungeon|Victoria Island|47|3|46.5|0.6|122.1
The Valley of Death|map|Hidden Street|Victoria Island|26|3|38.1|1.0|86.2
Thicket Around the Beach I|map|Victoria Road|Victoria Island|67|5|3.2|1.0|6.5
Thicket Around the Beach II|map|Victoria Road|Victoria Island|48|4|5.8|1.0|11.1
Thicket Around the Beach III|map|Victoria Road|Victoria Island|35|6|4.5|1.5|7.8
Thief's Construction Site|map|Hidden Street|Hidden Street|26|2|30.0|0.8|56
Thieves' Hideout|town|Victoria Road|Victoria Island||||| 
Tomato Field|map|Rainbow Street|Maple Island|25|4|2.9|1.0|5.7
Transfer Area|map|Kerning City Subway|Victoria Island|38|1|20.0|0.7|37
Tree Dungeon, Forest Up North I|map|Victoria Road|Victoria Island|29|2|13.7|1.0|26
Tree Dungeon, Forest Up North II|map|Victoria Road|Victoria Island|31|3|17.4|1.0|32.4
Tree Dungeon, Forest Up North III|map|Victoria Road|Victoria Island|44|3|14.7|0.9|27.6
Tree Dungeon, Forest Up North IV|map|Victoria Road|Victoria Island|44|2|11.6|0.9|21.9
Tree Dungeon, Forest Up North IX|map|Victoria Road|Victoria Island|20|1|33.0|0.8|63
Tree Dungeon, Forest Up North V|map|Victoria Road|Victoria Island|42|3|14.2|1.0|26.7
Tree Dungeon, Forest Up North VI|map|Victoria Road|Victoria Island|17|2|32.5|0.7|62.9
Tree Dungeon, Forest Up North VII|map|Victoria Road|Victoria Island|19|3|34.1|0.9|68.1
Tree Dungeon, Forest Up North VIII|map|Victoria Road|Victoria Island|17|1|33.0|0.8|63
Tree Dungeon, Monkey Forest I|map|Victoria Road|Victoria Island|31|2|39.7|0.9|84.8
Tree Dungeon, Monkey Forest II|map|Hidden Street|Victoria Island|30|2|39.9|0.9|85.5
Truth Booth|town|Truth Booth|Hidden Street||||| 
Up and Up <Level 1>|map|Hidden Street|Event||||| 
Up and Up <Level 2>|map|Hidden Street|Event||||| 
Up and Up <Level 3>|map|Hidden Street|Event||||| 
Utah's Pig Farm|map|Hidden Street|Victoria Island|28|1|200.0|1.0|
VIP Sauna|map|Dungeon|Victoria Island||||| 
Warrior's Rocky Mountain|map|Hidden Street|Hidden Street|30|2|30.0|0.8|56
Warriors' Sanctuary|town|Victoria Road|Victoria Island||||| 
West Domain of Perion|map|Victoria Road|Victoria Island|65|6|8.1|1.0|15.5
West Rocky Mountain I|map|Victoria Road|Victoria Island|53|3|5.5|0.8|10.8
West Rocky Mountain II|map|Victoria Road|Victoria Island|49|4|7.7|1.0|14.9
West Rocky Mountain III|map|Victoria Road|Victoria Island|67|6|12.7|0.9|23.9
West Rocky Mountain IV|map|Victoria Road|Victoria Island|33|4|25.0|1.0|46.9
West Street Corner of Perion|map|Victoria Road|Victoria Island|53|4|6.9|1.0|13.3
Wild Kargo's Area|map|Dungeon|Victoria Island|31|2|49.9|1.0|94.2
Yellow Mushroom House|town|Victoria Road|Victoria Island||||| 
Yellow Mushroom House|town|Victoria Road|Hidden Street||||| 
`;

function num(v: string): number | null {
  const t = v.trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseMaps(): MapInfo[] {
  const out: MapInfo[] = [];
  for (const line of RAW.split("\n")) {
    if (!line.trim()) continue;
    const f = line.split("|");
    if (f.length < 9) continue;
    out.push({
      name: f[0].trim(),
      kind: (f[1].trim() as MapKind) || "map",
      street: f[2].trim(),
      region: f[3].trim(),
      mobs: num(f[4]),
      types: num(f[5]),
      avgLevel: num(f[6]),
      mobRate: num(f[7]),
      expPerKill: num(f[8]),
    });
  }
  return out;
}

/** All maps, parsed once. */
export const MAPS: readonly MapInfo[] = parseMaps();

/** Distinct region names, in first-seen order. */
export const MAP_REGIONS: readonly string[] = Array.from(
  new Set(MAPS.map((m) => m.region)),
);

/** Only maps with combat data (huntable), i.e. not towns/empty stages. */
export const HUNTABLE_MAPS: readonly MapInfo[] = MAPS.filter(
  (m) => m.kind === "map" && m.avgLevel !== null,
);

/** Case-insensitive name search. */
export function searchMaps(query: string): MapInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...MAPS];
  return MAPS.filter((m) => m.name.toLowerCase().includes(q));
}

/** Huntable maps whose average monster level is within [min, max]. */
export function mapsByLevel(min: number, max: number): MapInfo[] {
  return HUNTABLE_MAPS.filter(
    (m) => m.avgLevel !== null && m.avgLevel >= min && m.avgLevel <= max,
  ).sort((a, b) => (a.avgLevel ?? 0) - (b.avgLevel ?? 0));
}

/** Maps in a given region (exact, case-insensitive). */
export function mapsByRegion(region: string): MapInfo[] {
  const r = region.trim().toLowerCase();
  return MAPS.filter((m) => m.region.toLowerCase() === r);
}

export interface MapRec extends MapInfo {
  /** Rough EXP-density score: expPerKill x mobs x mobRate. Higher = better. */
  score: number;
}

/**
 * Recommend huntable maps for a character level, ranked by EXP density.
 *
 * Only maps whose average monster level falls within a sensible band around
 * the player are considered (too-low maps waste time, too-high maps are
 * dangerous). Score = expPerKill x mob count x spawn-rate multiplier.
 */
export function recommendMaps(
  level: number,
  opts: { below?: number; above?: number; limit?: number } = {},
): MapRec[] {
  const below = opts.below ?? 5;
  const above = opts.above ?? 5;
  const limit = opts.limit ?? 8;
  const lo = level - below;
  const hi = level + above;

  return HUNTABLE_MAPS.filter(
    (m) =>
      m.expPerKill !== null &&
      m.mobs !== null &&
      m.avgLevel !== null &&
      m.avgLevel >= lo &&
      m.avgLevel <= hi,
  )
    .map((m) => ({
      ...m,
      score: (m.expPerKill ?? 0) * (m.mobs ?? 0) * (m.mobRate ?? 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
