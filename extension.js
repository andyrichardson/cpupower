/*
 *
 *  CPUPower for GNOME Shell preferences
 *  - Creates a widget to set the preferences of the cpupower extension
 *
 * Copyright (C) 2015
 *     Martin Koppehel <psl.kontakt@gmail.com>,
 *
 * This file is part of the gnome-shell extension cpupower.
 *
 * gnome-shell extension cpupower is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * gnome-shell extension cpupower is distributed in the hope that it
 * will be useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE.  See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with gnome-shell extension cpupower.  If not, see
 * <http://www.gnu.org/licenses/>.
 *
 */


const St = imports.gi.St;
const Atk = imports.gi.Atk;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const Panel = imports.ui.panel;
const PopupMenu = imports.ui.popupMenu;
const Gio = imports.gi.Gio;
const Slider = imports.ui.slider;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;

const Gettext = imports.gettext.domain('gnome-shell-extension-cpupower');
const _ = Gettext.gettext;
const SETTINGS_ID = 'org.gnome.shell.extensions.cpupower';
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const EXTENSIONDIR = Me.dir.get_path();
const CPUFreqBaseIndicator = Me.imports.baseindicator.CPUFreqBaseIndicator;
const UnsupportedIndicator = Me.imports.unsupported.UnsupportedIndicator;
const NotInstalledIndicator = Me.imports.notinstalled.NotInstalledIndicator;
const check_supported = Me.imports.utils.check_supported;
const check_installed = Me.imports.utils.check_installed;

const DEFAULT_EMPTY_NAME = 'No name';
const CPUFREQCTL = EXTENSIONDIR + '/cpufreqctl';
const PKEXEC = GLib.find_program_in_path('pkexec');

const CPUFreqProfileButton = new Lang.Class({
    Name: 'cpupower.CPUFreqProfileButton',
    Extends: PopupMenu.PopupMenuItem,
    _init: function(profile)
    {
        this._profile = profile;
        this.parent(_(this._profile.getName() || DEFAULT_EMPTY_NAME), {reactive:true});
    },

    getProfile : function()
    {
        return this._profile;
    },
});


const CPUFreqProfile = new Lang.Class({
    Name: 'cpupower.CPUFreqProfile',

    _init: function()
    {
        this.minFrequency=0;
        this.maxFrequency=100;
        this.isTurboBoostActive=true;
        this._name = 'Default';
        this.imLabel = new CPUFreqProfileButton(this);
    },

    getMinFrequency: function()
    {
        return this.minFrequency;
    },

    getMaxFrequency: function()
    {
        return this.maxFrequency;
    },

    getTurboBoost: function()
    {
        return this.isTurboBoostActive;
    },

    getName: function()
    {
        return this._name;
    },

    load: function(input)
    {
        this.setMinFrequency(input[0]);
        this.setMaxFrequency(input[1]);
        this.setTurboBoost(input[2]);
        this.setName(input[3]);
    },

    setMinFrequency: function(value)
    {
        this.minFrequency = value;
    },

    setMaxFrequency: function(value)
    {
        this.maxFrequency = value;
    },

    setTurboBoost: function(value)
    {
        this.isTurboBoostActive = value;
    },

    setName: function(value)
    {
        this._name = value;
        this.imLabel = new CPUFreqProfileButton(this);
    },

    getUiComponent: function()
    {
        return this.imLabel;
    },
});

const CPUFreqIndicator = new Lang.Class({
    Name: 'cpupower.CPUFreqIndicator',
    Extends: CPUFreqBaseIndicator,

    _init: function()
    {
        this.cpufreq = 800;
        this.isTurboBoostActive = true;
        this.minVal = 0;
        this.maxVal = 30;

        // read the last-settings file.
        if(!GLib.file_test(EXTENSIONDIR + '/.last-settings', GLib.FileTest.EXISTS))
        {
            let result = GLib.spawn_command_line_sync(CPUFREQCTL + ' turbo get', this.out);
            let returnCode = result[1];
            this.isTurboBoostActive = returnCode;

            result = GLib.spawn_command_line_sync(CPUFREQCTL + ' min get', this.out);
            returnCode = result[1];
            this.minVal = returnCode;

            result = GLib.spawn_command_line_sync(CPUFREQCTL + ' max get', this.out);
            returnCode = result[1];
            this.maxVal = returnCode;
        }
        else
        {
            let lines = Shell.get_file_contents_utf8_sync(EXTENSIONDIR + '/.last-settings').split('\n');
            if(lines.length > 2)
            {
                this.minVal = parseInt(lines[0]);
                this.maxVal = parseInt(lines[1]);
                this.isTurboBoostActive = (lines[2].indexOf('true') > -1);
                this._updateMax(true);
                this._updateMin(true);
                this._updateTurbo(true);
            }
        }
        this.parent();
    },

    _enable: function()
    {
        this.parent();
        this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateFreq));
        this.timeout_mm = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateFreqMm));
    },


    _createMenu: function()
    {
        this.parent();

        this.lblActive = (this.settings.get_boolean('show-freq-in-taskbar'));
        this.lblUnit = (this.settings.get_boolean('taskbar-freq-unit-ghz'));

        let _profiles = this.settings.get_value('profiles');
        _profiles = _profiles.deep_unpack();
        this.profiles = [];
        for(var j = 0; j < _profiles.length; j++)
        {
            var profile = new CPUFreqProfile();
            profile.load(_profiles[j]);
            this.profiles.push(profile);
        }
        this.profiles.reverse();
        
        this.imMinTitle = new PopupMenu.PopupMenuItem(_('Minimum Frequency:'), {reactive: false});
        this.imMinLabel = new St.Label({text: this._getMinText()});
        this.imMinTitle.actor.add_child(this.imMinLabel, {align: St.Align.END});

        this.imMaxTitle = new PopupMenu.PopupMenuItem(_('Maximum Frequency:'), {reactive: false});
        this.imMaxLabel = new St.Label({text: this._getMaxText()});
        this.imMaxTitle.actor.add_child(this.imMaxLabel, {align: St.Align.END});

        this.imTurboSwitch = new PopupMenu.PopupSwitchMenuItem(_('Turbo Boost:'), this.isTurboBoostActive);
        this.imTurboSwitch.connect('toggled', Lang.bind(this, function(item)
        {
            this.isTurboBoostActive = item.state;
            this._updateTurbo();
        }));

        global.logError(this.minVal + ' ' + this.maxVal);
        this.imSliderMin = new PopupMenu.PopupBaseMenuItem({activate: false});
        this.minSlider = new Slider.Slider(this.minVal / 100);
        this.minSlider.connect('value-changed', Lang.bind(this, function(item)
        {
            this.minVal = Math.floor(item.value * 100);
            this.imMinLabel.set_text(this._getMinText());
            this._updateMin();
        }));
        this.imSliderMin.actor.add(this.minSlider.actor, {expand: true});

        this.imSliderMax = new PopupMenu.PopupBaseMenuItem({activate: false});
        this.maxSlider = new Slider.Slider(this.maxVal / 100);
        this.maxSlider.connect('value-changed', Lang.bind(this, function(item)
        {
            this.maxVal = Math.floor(item.value * 100);
            this.imMaxLabel.set_text(this._getMaxText());
            this._updateMax();
        }));
        this.imSliderMax.actor.add(this.maxSlider.actor, {expand: true});

        this.imCurrentTitle = new PopupMenu.PopupMenuItem(_('Current Frequency:'), {reactive:false});
        this.imCurrentLabel = new St.Label({text: this._getCurFreq()});
        this.imCurrentTitle.actor.add_child(this.imCurrentLabel, {align: St.Align.END});

        this.section.addMenuItem(this.imMinTitle);
        this.section.addMenuItem(this.imSliderMin);
        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.section.addMenuItem(this.imMaxTitle);
        this.section.addMenuItem(this.imSliderMax);
        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.section.addMenuItem(this.imTurboSwitch);
        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.section.addMenuItem(this.imCurrentTitle);
        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        for(var i = 0; i < this.profiles.length; i++)
        {
            var uiComponent= this.profiles[i].getUiComponent();
            uiComponent.connect('activate', function (item) {
                this._applyProfile(item.getProfile());
            }.bind(this));
            this.section.addMenuItem(uiComponent);
        }

        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.imPrefsBtn = new PopupMenu.PopupMenuItem(_('Preferences'));
        this.imPrefsBtn.connect('activate', this._onPreferencesActivate.bind(this));
        this.section.addMenuItem(this.imPrefsBtn);

    },

    _applyProfile: function(profile)
    {
        this.minVal = profile.getMinFrequency();
        this._updateMin();

        this.maxVal = profile.getMaxFrequency();
        this._updateMax();

        this.isTurboBoostActive = profile.getTurboBoost();
        this._updateTurbo();

        this._updateUi();
    },

    _disable: function()
    {
        this.parent();
        Mainloop.source_remove(this.timeout);
        Mainloop.source_remove(this.timeout_mm);
    },

    _getMinText: function()
    {
        return Math.floor(this.minVal).toString() + '%';
    },

    _getMaxText: function()
    {
        return Math.floor(this.maxVal).toString() + '%';
    },

    _updateFile: function()
    {
        let cmd = Math.floor(this.minVal) + '\n' + Math.floor(this.maxVal) + '\n' + (this.isTurboBoostActive ? 'true':'false') + '\n';
        let path = EXTENSIONDIR + '/.last-settings';
        GLib.file_set_contents(path, cmd);
    },

    _updateMax: function(force = false)
    {
        if(!force && !this.menu.isOpen) return;
        let cmd = [PKEXEC, CPUFREQCTL, 'max', Math.floor(this.maxVal).toString()].join(' ');
        Util.trySpawnCommandLine(cmd);
        this._updateFile();
    },

    _updateMin: function(force = false)
    {
        if(!force && !this.menu.isOpen) return;
        let cmd = [PKEXEC, CPUFREQCTL, 'min', Math.floor(this.minVal).toString()].join(' ');
        Util.trySpawnCommandLine(cmd);
        this._updateFile();
    },

    _updateTurbo: function(force = false)
    {
        if(!force && !this.menu.isOpen) return;
        let cmd = [PKEXEC, CPUFREQCTL, 'turbo', (this.isTurboBoostActive ? '1' : '0')].join(' ');
        Util.trySpawnCommandLine(cmd);
        this._updateFile();
    },

    _updateUi: function()
    {
        this.imMinLabel.set_text(this._getMinText());
        this.minSlider.setValue(this.minVal / 100.0);

        this.imMaxLabel.set_text(this._getMaxText());
        this.maxSlider.setValue(this.maxVal / 100.0);

        this.imTurboSwitch.setToggleState(this.isTurboBoostActive);

        for(var i = 0; i < this.profiles.length; i++)
        {
            var o = PopupMenu.Ornament.NONE;
            var p = this.profiles[i];
            if(this.minVal == p.getMinFrequency() && this.maxVal == p.getMaxFrequency() && this.isTurboBoostActive == p.getTurboBoost())
                o = PopupMenu.Ornament.DOT;
            p.getUiComponent().setOrnament(o);

        }
    },

    _updateFreq: function()
    {
        let lines = Shell.get_file_contents_utf8_sync('/proc/cpuinfo').split('\n');
        for(let i = 0; i < lines.length; i++)
        {
            let line = lines[i];

            if(line.search(/cpu mhz/i) < 0)
                continue;
            this.cpufreq = parseInt(line.substring(line.indexOf(':') + 2));
            this.imCurrentLabel.set_text(this._getCurFreq());
            if(this.lblActive)
                this.lbl.set_text(this._getCurFreq());
            else
                this.lbl.set_text('');
            break;
        }
        return true;
    },

    _updateFreqMm: function()
    {
        if(!this.menu.isOpen) return true;

        let [res, out] = GLib.spawn_command_line_sync(CPUFREQCTL + ' turbo get');
        this.isTurboBoostActive = parseInt(out.toString()) == 1;

        let [res, out] = GLib.spawn_command_line_sync(CPUFREQCTL + ' min get');
        this.minVal = parseInt(out.toString());

        let [res, out] = GLib.spawn_command_line_sync(CPUFREQCTL + ' max get');
        this.maxVal = parseInt(out.toString());
        this._updateUi();
        return true;
    },

    _getCurFreq: function()
    {
        if(this.lblUnit)
            return (this.cpufreq.toString() / 1000).toFixed(2) + 'GHz';
        else
            return this.cpufreq.toString() + 'MHz';
    },

    _onPreferencesActivate : function(item)
    {
        Util.trySpawnCommandLine('gnome-shell-extension-prefs cpupower@mko-sl.de'); //ensure this will get logged
        return 0;
    },
});

function init(meta)
{
    Convenience.initTranslations('gnome-shell-extension-cpupower');
}

let _indicator = null;

function _enableIndicator()
{
    Main.panel.addToStatusArea('cpupower', _indicator);
    _indicator._enable();
}

function enable()
{
    try
    {
        check_supported(function(supported) {
            if (!supported)
            {
                _indicator = new UnsupportedIndicator();
                _enableIndicator();
                return;
            }

            check_installed(function(installed) {
                if (!installed)
                    _indicator = new NotInstalledIndicator();
                else
                    _indicator = new CPUFreqIndicator();
                _enableIndicator();
            });
        });
    }
    catch(e)
    {
        global.logError(e.message);
    }
}

function disable()
{
    if (_indicator != null)
    {
        _indicator._disable();
        _indicator.destroy();
    }
}
