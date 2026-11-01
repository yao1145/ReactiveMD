<computed name="displayName" value="{{ trim(name) == '' ? 'This participant' : trim(name) }}">
<computed name="sessionMinutes" value="{{ pace == 'guided' ? 90 : 120 }}">

# What shall we learn this weekend?

Community learning group · About 2 minutes

We're planning a small weekend session. Before booking a room, we'd like to hear which times and topics work for you. This is a locally filled sample; copy the summary below and share it with the organiser when you're done.

## What works for you?

<panel title="Your preferences">
<input bind="name" label="What should we call you?" initial="Lin" placeholder="A nickname is fine">
<choices bind="format" label="Preferred way to join" initial="onsite">
<option value="onsite">In person, community room</option>
<option value="online">Online, video call</option>
</choices>
<select bind="slot" label="A convenient time" initial="sat-afternoon">
<option value="sat-morning">Saturday morning</option>
<option value="sat-afternoon">Saturday afternoon</option>
<option value="sun-afternoon">Sunday afternoon</option>
</select>
<slider bind="fee" label="Maximum cost per person (CNY)" initial="40" min="0" max="80" step="10">
</panel>

The fee covers the room and materials. If you choose an online session, keep your own spending limit so the organiser can compare the cost of posting materials.

## What would you like to leave with?

<multi-select bind="topics" label="Choose up to two topics" max-selected="2">
<option value="photos">Organise a set of phone photos</option>
<option value="budget">Make a monthly spending sheet</option>
<option value="writing">Finish a short personal essay</option>
</multi-select>

<radio-group bind="pace" label="How do you prefer to learn?" initial="guided">
<option value="guided">Follow a complete worked example</option>
<option value="independent">Discuss a question of my own</option>
</radio-group>

<checkbox bind="written" label="I'd like written steps in advance">
<checkbox bind="volunteer" label="I can help with check-in or materials">
<textarea bind="notes" label="Anything else to arrange?" placeholder="For example: bringing your own photos, or needing larger-print materials">

<data-table label="Your preparation list" rows="{{ topics }}" key="{{ item }}" max-rows="2">
<column label="Topic" value="{{ item == 'photos' ? 'Phone photo organisation' : item == 'budget' ? 'Monthly spending sheet' : 'Personal essay' }}">
<column label="Bring along" value="{{ item == 'photos' ? '10 photos you want to organise' : item == 'budget' ? 'A week of spending records' : 'A small moment you want to describe' }}">
</data-table>

## Share this with the organiser

<card title="My learning session preferences">
{{ displayName }} prefers an {{ format == 'onsite' ? 'in-person' : 'online' }} session on {{ slot == 'sat-morning' ? 'Saturday morning' : slot == 'sat-afternoon' ? 'Saturday afternoon' : 'Sunday afternoon' }}, with a limit of CNY {{ fee }} per person.

Topics selected: {{ len(topics) }}. Preferred approach: {{ pace == 'guided' ? 'a worked example' : 'discussion of personal questions' }}. Allow about {{ sessionMinutes }} minutes.

Materials: {{ written ? 'Please send written steps beforehand.' : 'An explanation during the session is enough.' }}

Notes: {{ trim(notes) == '' ? 'None.' : trim(notes) }}

<if when="{{ volunteer }}">
I can help with check-in or materials. Please let me know when to arrive.
</if>
</card>

<if when="{{ len(topics) == 0 }}">
<alert title="One more small choice">Choose the topic you most want to try so the organiser can prepare materials.</alert>
</if>

## How will the session be confirmed?

Once replies are collected, the organiser will look for a shared time and confirm numbers and a room. The announcement should include the actual fee, what to bring and how to cancel.

This summary records your preferences. The organiser's follow-up will confirm the time and available places.
