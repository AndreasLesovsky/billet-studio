import { Component } from '@angular/core';
import { siteName } from '../../core/environments/environment';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
})
export class Home {
  protected readonly siteName = siteName;
}
