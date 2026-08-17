import { Routes } from '@angular/router';
import { HomeComponent } from './features/home/home.component';
import { TopPredictionsComponent } from './features/top-predictions/top-predictions.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'top-predictions', component: TopPredictionsComponent },
  { path: '**', redirectTo: '' },
];
