# PlantR - A Plant Management Platform

## Top-level Goals

I have a large collection of Roses (400 plants), Hydrangeas (50 plants), Rhodedendruns (50 plants), Flowering Trees (60 plants), Fruit Trees (40 plants), indoor orchids (400 plants), outdoor orchids (250 plants) and other plants (300-ish). I want to build an app that lets me track all of my plants. I want to capture pictures, GPS location, notes, and also be able to log feeding, treating, fertilizing, watering actions for each plant. I want to be able to browse by type of plant, location tag (eg. Big Rose Garden), etc. I want to be able to show the markers for each plant on a map of my property.

## Registration and Lookup

The main action the user will take is to scan a QR code. This results in either the plant details being displayed (if found), or a new entry being created.

### Plant detials

The plant details page shows the cover photo, then name, type, description, and notes. Then photos in a carousel, with a "+" to add more. Long-press on each photo shows options like "Set Cover Photo" and "Delete". An "Actions" section appears at the bottom that shows a log of actions taken. Quick-action buttons are at the top of the section to allow the user to record a new action. These include "Feeding", "Watering", "Fertilizing" and "Treating". When tapping one of these icons, the user can add notes, hit save or cancel. The date and time is recorded with the action. The actions appear in reverse chronological order in the actions section.

### New Plant

If the QR code is not found, then a new plant entry is recorded with the server. The plant details page is empty and the user is able to set any of the options including the cover photo. When the cover photo is taken, an asynchronous call is made to a plant identification service. If the plant is positively identified (90% confidence), then the identified plant details are added to the plant record as extra fields.

## Tabs

The app will have multiple tabs (shown on the bottom of the screen). Map, Browse, Scan (center prominant button), Reports, and Settings. Use icons instead of labels for the tabs.

### Map Tab

For the Map tab, show a map of my property. At first, the map is just blank. Each time I scan a QR code, a dot shows where the scan was done. As the set of dots grows, "zoom" the map to include all the dots (with a reasonable margin around the side). Allow the user to add a shape (rectangle or ellipse) to the map. They can drag the shape and resize it using resizing handles. Tapping inside the shape allows the user to set a name. The user can choose a color for the shape by tapping on the color wheel. When touching anywhere outside the shape, the shape "locks" and is no longer movable or resizable. The user can long-press on a shape to re-enter edit mode. The shape represents a location. QR codes that are scanned and appear inside the shape, will automatically be given that shape's location tag.

### Browse Tab

For the browse tab, we use Tiles to show categories. Tiles include Location, Type, Species, and All. We may add more tiles later, so make this scrollable and expandable. When choosing one of the categories, show the category entries (eg. for Location category, show Location 1, Location 2, Location 3, etc.). When choosing one of the category entries, then show the list of plants that match. When showing the list of plants, the user can switch between tile-view (default, shows cover photo if present, or a default icon for that type of plant), and list view (shows name, type, and possibly other details TBD). When selecting a plant, show the plant details page.

### Scan Button

The Scan button will open the camera with a box to center the QR code inside of. An X button allows the user to cancel the scan. The reports tab shows "Coming soon". The 

### Reports Tab

Show "Coming Soon" for now

### Settings Tab

The Settings tab allows the user to manage users and plant types. The user management section shows the current list of users, allows the user to add a new user by providing a name and password, and to remove an existing user. You cannot remove yourself though, and there must be at least one user registered. The plant types section allows the user to view, remove or add plant types.

## Architecture

The app will run on my iphone. The data will be stored in a server. This app will be built just for my family, so the scale is reasonably small. We can store the details in Postgres, and photos as files on the server's file system. We can choose a more scalable architecture later. The whole server will run in one docker instance. The server will expose the PlantR API, and also will host a web interface that supports the Map View, Browse View, and Plant Details view.

## Security

Since this is just for my family, we will support a simple username/password authentication to gate access. On my iphone, save the credentials on the phone so I don't have to type them in again every time. It never expires. for the web app, prompt to login once if the persistent cookie doesn't exist, after that just use the auth cookie, which never expires. There will be a default user called "admin" with password "admin". When logging in for the first time with this account, the user is forced to change the password to something else. Enable this experience in both the iPhone and the Web application.